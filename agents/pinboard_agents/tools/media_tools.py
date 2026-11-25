import ipaddress
import json
import os
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from google.adk.tools import ToolContext
from google.genai import types

from .gemini_client import gemini_async_client
from .model_logging import generate_content_with_logging

MAX_AUDIO_BYTES = 25 * 1024 * 1024
ALLOWED_AUDIO_TYPES = {
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
}


def _expected_object_path(url: str, user_id: str, creation_id: str, media_kind: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.hostname == "storage.googleapis.com":
        bucket = os.getenv("MEDIA_STORAGE_BUCKET", "")
        object_path = unquote(parsed.path).lstrip("/")
        bucket_prefix = f"{bucket}/"
        if not bucket or not object_path.startswith(bucket_prefix):
            raise ValueError("The signed media URL is outside the configured bucket.")
        object_path = object_path[len(bucket_prefix) :]
        query = parse_qs(parsed.query)
        if not query.get("X-Goog-Signature"):
            raise ValueError("The media URL is not a signed Cloud Storage URL.")
    elif (
        parsed.scheme == "http"
        and os.getenv("NODE_ENV") != "production"
        and (parsed.hostname == "localhost" or _is_loopback(parsed.hostname))
    ):
        parts = unquote(parsed.path).split("/")
        if len(parts) < 7 or parts[1] != "v0" or parts[2] != "b":
            raise ValueError("The local media URL is invalid.")
        bucket = os.getenv("MEDIA_STORAGE_BUCKET", "")
        if parts[3] != bucket or parts[4] != "o":
            raise ValueError("The local media URL is outside the configured bucket.")
        object_path = "/".join(parts[5:])
    else:
        raise ValueError("The media URL host is not allowed.")

    expected_prefix = f"users/{user_id}/creations/{creation_id}/{media_kind}/"
    object_name = (
        object_path[len(expected_prefix) :]
        if object_path.startswith(expected_prefix)
        else ""
    )
    if not object_name or "/" in object_name:
        raise ValueError("The media URL is outside this user's creation.")
    return object_path


def _is_loopback(hostname: str | None) -> bool:
    try:
        return ipaddress.ip_address(hostname or "").is_loopback
    except ValueError:
        return False


async def download_trusted_media(
    url: str,
    user_id: str,
    creation_id: str,
    media_kind: str,
    content_type: str,
    maximum_bytes: int,
) -> bytes:
    _expected_object_path(url, user_id, creation_id, media_kind)
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > maximum_bytes:
                raise ValueError("The uploaded media exceeds the supported size.")
            chunks = bytearray()
            async for chunk in response.aiter_bytes():
                chunks.extend(chunk)
                if len(chunks) > maximum_bytes:
                    raise ValueError("The uploaded media exceeds the supported size.")

    if not chunks:
        raise ValueError("The uploaded media is empty.")
    if media_kind == "audio" and content_type not in ALLOWED_AUDIO_TYPES:
        raise ValueError("The uploaded audio type is not supported.")
    return bytes(chunks)


async def transcribe_audio_reference(
    *,
    audio_url: str,
    audio_content_type: str,
    user_id: str,
    creation_id: str,
    request_id: str | None = None,
) -> dict[str, object]:
    audio_bytes = await download_trusted_media(
        audio_url,
        user_id,
        creation_id,
        "audio",
        audio_content_type,
        MAX_AUDIO_BYTES,
    )
    model = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.5-flash")
    async with gemini_async_client() as client:
        response = await generate_content_with_logging(
            client,
            stage="audio_transcription",
            model=model,
            request_id=request_id,
            contents=[
                types.Part.from_text(
                    text=(
                        "Transcribe only the spoken editing instructions accurately. Return "
                        "JSON with a `transcription` string and a numeric `confidence` from "
                        "0 to 1. Do not infer words that are not audible."
                    )
                ),
                types.Part.from_bytes(
                    data=audio_bytes,
                    mime_type=audio_content_type,
                ),
            ],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("The audio transcription model returned no text.")
    try:
        payload = json.loads(text)
        transcription = str(payload.get("transcription", "")).strip()
        confidence = float(payload.get("confidence"))
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError("The audio transcription model returned invalid JSON.") from error
    if not transcription or not 0 <= confidence <= 1:
        raise RuntimeError("The audio transcription model returned an invalid transcript.")
    return {"transcription": transcription[:4000], "confidence": confidence}


async def transcribe_user_audio(tool_context: ToolContext) -> dict[str, object]:
    """Transcribe the optional audio uploaded for this creation."""
    context = tool_context.state["workflow_context"]
    if not context.get("audio_url"):
        return {"transcription": "", "status": "skipped_no_audio"}
    override = context.get("audio_transcript_override", "").strip()
    if override:
        tool_context.state["audio_transcript"] = override[:4000]
        return {"transcription": override[:4000], "confidence": None, "edited": True}
    result = await transcribe_audio_reference(
        audio_url=context["audio_url"],
        audio_content_type=context["audio_content_type"],
        user_id=context["user_id"],
        creation_id=context["creation_id"],
        request_id=context.get("request_id"),
    )
    tool_context.state["audio_transcript"] = result["transcription"]
    tool_context.state["audio_confidence"] = result["confidence"]
    return result

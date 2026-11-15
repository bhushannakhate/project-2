import base64
import json
import logging
import os

from google.adk.tools import ToolContext
from google.genai import types

from .gemini_client import gemini_async_client
from .media_tools import download_trusted_media

MAX_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
logger = logging.getLogger("pinboard_agent.tools")


def _log_model_failure(stage: str, model: str, error: Exception) -> None:
    code = getattr(error, "code", None)
    if callable(code):
        try:
            code = code()
        except Exception:
            code = None
    status = getattr(error, "status", None)
    status_code = getattr(error, "status_code", None)
    logger.error(
        "Gemini tool failed stage=%s model=%s error_type=%s "
        "status=%s status_code=%s code=%s",
        stage,
        model,
        type(error).__name__,
        str(status)[:80] if status is not None else None,
        status_code,
        code,
    )


def _workflow_context(tool_context: ToolContext) -> dict:
    return tool_context.state["workflow_context"]


def _decoded_state_image(tool_context: ToolContext, key: str) -> tuple[bytes, str]:
    encoded = tool_context.state.get(key)
    content_type_key = f"{key.removesuffix('_base64')}_content_type"
    content_type = tool_context.state.get(content_type_key)
    if not encoded or content_type not in IMAGE_CONTENT_TYPES:
        raise ValueError("The workflow image is unavailable or unsupported.")
    data = base64.b64decode(encoded, validate=True)
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("The workflow image exceeds the supported size.")
    return data, content_type


async def _generate_image(
    tool_context: ToolContext,
    source_image: bytes,
    source_content_type: str,
    prompt: str,
) -> tuple[bytes, str]:
    model = os.getenv("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image")
    try:
        async with gemini_async_client() as client:
            response = await client.models.generate_content(
                model=model,
                contents=[
                    types.Part.from_text(text=prompt),
                    types.Part.from_bytes(
                        data=source_image,
                        mime_type=source_content_type,
                    ),
                ],
                config=types.GenerateContentConfig(
                    response_modalities=[types.Modality.TEXT, types.Modality.IMAGE],
                ),
            )
    except Exception as error:
        _log_model_failure("image_generation", model, error)
        raise
    for candidate in response.candidates or []:
        for part in candidate.content.parts if candidate.content else []:
            if part.inline_data and part.inline_data.data:
                data = part.inline_data.data
                content_type = part.inline_data.mime_type or "image/png"
                if content_type not in IMAGE_CONTENT_TYPES:
                    raise ValueError("Gemini returned an unsupported image type.")
                if not data or len(data) > MAX_IMAGE_BYTES:
                    raise ValueError("Gemini returned an image that exceeds the size limit.")
                tool_context.state["generated_image_base64"] = base64.b64encode(
                    data
                ).decode("ascii")
                tool_context.state["generated_image_content_type"] = content_type
                return data, content_type
    raise RuntimeError("Gemini did not return an image.")


async def analyze_source_photo(tool_context: ToolContext) -> dict[str, str]:
    """Analyze the validated source photo imported for this user's creation."""
    context = _workflow_context(tool_context)
    try:
        source_image = await download_trusted_media(
            context["source_image_url"],
            context["user_id"],
            context["creation_id"],
            "sourceImage",
            context["source_image_content_type"],
            MAX_IMAGE_BYTES,
        )
    except Exception as error:
        logger.error(
            "Gemini tool failed stage=source_image_download error_type=%s",
            type(error).__name__,
        )
        raise

    model = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.5-flash")
    try:
        async with gemini_async_client() as client:
            response = await client.models.generate_content(
                model=model,
                contents=[
                    types.Part.from_text(
                        text=(
                            "Describe the visible subject, composition, colors, and salient "
                            "details of this photo in a concise factual paragraph. Do not "
                            "identify people or infer sensitive attributes."
                        )
                    ),
                    types.Part.from_bytes(
                        data=source_image,
                        mime_type=context["source_image_content_type"],
                    ),
                ],
            )
    except Exception as error:
        _log_model_failure("source_photo_analysis", model, error)
        raise
    analysis = (response.text or "").strip()
    if not analysis:
        logger.error(
            "Gemini tool returned no text stage=source_photo_analysis model=%s",
            model,
        )
        raise RuntimeError("Gemini returned no source-photo analysis.")
    tool_context.state["source_image_base64"] = base64.b64encode(
        source_image
    ).decode("ascii")
    tool_context.state["source_image_content_type"] = context[
        "source_image_content_type"
    ]
    tool_context.state["image_analysis"] = analysis[:2000]
    return {"analysis": analysis[:2000]}


async def generate_edited_image(tool_context: ToolContext) -> dict[str, str]:
    """Edit the imported source photo using the coordinator's brief and audio."""
    if tool_context.state.get("generated_image_base64"):
        return {"generated": "The initial image is already available."}

    source_image, source_content_type = _decoded_state_image(
        tool_context, "source_image_base64"
    )
    prompt = (
        "Edit the supplied source photo according to this creative brief: "
        f"{tool_context.state.get('creative_brief', '')}\n"
        "The user's spoken instruction was: "
        f"{tool_context.state.get('audio_transcript', '')}\n"
        "Photo analysis: "
        f"{tool_context.state.get('image_analysis', '')}\n"
        "Preserve the original subject and relevant composition unless the user "
        "explicitly requested a change."
    )
    await _generate_image(
        tool_context,
        source_image,
        source_content_type,
        prompt,
    )
    return {"generated": "The edited image is ready for review."}


async def _assess_image(
    tool_context: ToolContext,
    source_image: bytes,
    source_content_type: str,
    generated_image: bytes,
    generated_content_type: str,
) -> dict[str, object]:
    async with gemini_async_client() as client:
        response = await client.models.generate_content(
            model=os.getenv("GEMINI_TEXT_MODEL", "gemini-3.5-flash"),
            contents=[
                types.Part.from_text(
                    text=(
                        "Review the generated image for fidelity to the user's typed and "
                        "spoken instructions, relevance to the source photo, and obvious "
                        "visual defects. Return only JSON with boolean `approved` and "
                        "string `feedback`. Reject only for a material instruction mismatch "
                        "or a clear defect. Typed instructions: "
                        f"{tool_context.state.get('instructions', '')}\nSpoken instructions: "
                        f"{tool_context.state.get('audio_transcript', '')}\nCreative brief: "
                        f"{tool_context.state.get('creative_brief', '')}"
                    )
                ),
                types.Part.from_text(text="Original source photo:"),
                types.Part.from_bytes(data=source_image, mime_type=source_content_type),
                types.Part.from_text(text="Generated image:"),
                types.Part.from_bytes(
                    data=generated_image,
                    mime_type=generated_content_type,
                ),
            ],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
    try:
        assessment = json.loads(response.text or "")
    except (TypeError, json.JSONDecodeError) as error:
        raise RuntimeError("Gemini returned an invalid review result.") from error
    if (
        not isinstance(assessment, dict)
        or not isinstance(assessment.get("approved"), bool)
        or not isinstance(assessment.get("feedback"), str)
    ):
        raise RuntimeError("Gemini returned an incomplete review result.")
    return assessment


async def review_and_revise_once(tool_context: ToolContext) -> dict[str, object]:
    """Review the generated image and perform at most one automated revision."""
    existing = tool_context.state.get("review_result")
    if existing is not None:
        return existing

    source_image, source_content_type = _decoded_state_image(
        tool_context, "source_image_base64"
    )
    generated_image, generated_content_type = _decoded_state_image(
        tool_context, "generated_image_base64"
    )
    assessment = await _assess_image(
        tool_context,
        source_image,
        source_content_type,
        generated_image,
        generated_content_type,
    )
    revision_count = 0
    if not assessment["approved"]:
        revision_prompt = (
            "Revise the supplied source photo to follow the user's requested edit. "
            f"Creative brief: {tool_context.state.get('creative_brief', '')}\n"
            f"Review feedback: {assessment['feedback']}\n"
            "Spoken instructions: "
            f"{tool_context.state.get('audio_transcript', '')}"
        )
        await _generate_image(
            tool_context,
            source_image,
            source_content_type,
            revision_prompt,
        )
        revision_count = 1
        generated_image, generated_content_type = _decoded_state_image(
            tool_context, "generated_image_base64"
        )
        assessment = await _assess_image(
            tool_context,
            source_image,
            source_content_type,
            generated_image,
            generated_content_type,
        )

    result = {
        "approved": assessment["approved"],
        "feedback": assessment["feedback"][:1000],
        "revision_count": revision_count,
    }
    tool_context.state["review_result"] = result
    tool_context.state["revision_count"] = revision_count
    return result


async def prepare_publication(
    caption: str,
    tool_context: ToolContext,
) -> dict[str, object]:
    """Prepare approved output for the authenticated Express publishing workflow."""
    review = tool_context.state.get("review_result", {})
    if review.get("approved") is not True:
        return {"prepared": False, "reason": "The image was not approved."}

    image_base64 = tool_context.state.get("generated_image_base64")
    image_content_type = tool_context.state.get("generated_image_content_type")
    if not image_base64 or image_content_type not in IMAGE_CONTENT_TYPES:
        raise ValueError("The reviewed output image is unavailable.")

    tool_context.state["publication_package"] = {
        "approved": True,
        "image_base64": image_base64,
        "image_content_type": image_content_type,
        "revision_count": review.get("revision_count", 0),
        "caption": caption.strip()[:1000],
        "audio_summary": tool_context.state.get("audio_transcript", "")[:700],
        "image_analysis": tool_context.state.get("image_analysis", "")[:700],
    }
    return {
        "prepared": True,
        "revision_count": review.get("revision_count", 0),
    }

import base64
import ipaddress
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

if __package__:
    from .pinboard_agents.agent import root_agent
    from .pinboard_agents.tools.media_tools import (
        ALLOWED_AUDIO_TYPES,
        MAX_AUDIO_BYTES,
        transcribe_audio_reference,
    )
else:
    from pinboard_agents.agent import root_agent
    from pinboard_agents.tools.media_tools import (
        ALLOWED_AUDIO_TYPES,
        MAX_AUDIO_BYTES,
        transcribe_audio_reference,
    )

APP_NAME = "pinboard_studio"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
logger = logging.getLogger("pinboard_agent")
session_service = InMemorySessionService()
runner = Runner(
    app_name=APP_NAME,
    agent=root_agent,
    session_service=session_service,
)


class AgentWorkflowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    user_id: str = Field(min_length=1, max_length=128)
    creation_id: str = Field(min_length=1, max_length=1500)
    workflow_id: str
    instructions: str = Field(max_length=2000)
    source_image_url: str = Field(min_length=1, max_length=4096)
    source_image_content_type: Literal["image/jpeg", "image/png", "image/webp"]
    audio_url: str | None = Field(default=None, min_length=1, max_length=4096)
    audio_content_type: str | None = None
    audio_transcript: str | None = Field(default=None, max_length=4000)

    @field_validator("user_id", "creation_id")
    @classmethod
    def validate_document_id(cls, value: str) -> str:
        if "/" in value or value.strip() != value:
            raise ValueError("Invalid document identifier.")
        return value

    @field_validator("workflow_id")
    @classmethod
    def validate_workflow_id(cls, value: str) -> str:
        try:
            UUID(value)
        except ValueError as error:
            raise ValueError("Invalid workflow identifier.") from error
        return value

    @field_validator("audio_content_type")
    @classmethod
    def validate_audio_type(cls, value: str | None) -> str | None:
        if value is not None and value not in ALLOWED_AUDIO_TYPES:
            raise ValueError("Unsupported audio type.")
        return value

    @model_validator(mode="after")
    def validate_modalities(self):
        if bool(self.audio_url) != bool(self.audio_content_type):
            raise ValueError("Audio URL and content type must be provided together.")
        if not self.instructions.strip() and not self.audio_url:
            raise ValueError("Written instructions or audio are required.")
        return self


def _is_loopback_request(request: Request) -> bool:
    host = request.client.host if request.client else ""
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


async def _authorize_caller(request: Request) -> None:
    if os.getenv("NODE_ENV", "development") != "production":
        if not _is_loopback_request(request):
            raise HTTPException(status_code=403, detail="Local requests must use loopback.")
        return

    expected_audience = os.getenv("ADK_EXPECTED_AUDIENCE", "")
    expected_caller = os.getenv("ADK_EXPECTED_CALLER_SERVICE_ACCOUNT", "")
    if not expected_audience or not expected_caller:
        raise HTTPException(status_code=503, detail="Agent service authentication is not configured.")

    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="A Google-signed caller token is required.")

    try:
        claims = await run_in_threadpool(
            id_token.verify_oauth2_token,
            token,
            GoogleAuthRequest(),
            expected_audience,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="The caller token is invalid.") from None

    if (
        claims.get("email") != expected_caller
        or claims.get("email_verified") is not True
    ):
        raise HTTPException(status_code=403, detail="The caller is not authorized.")


async def create_scoped_session(
    service: InMemorySessionService,
    user_id: str,
    creation_id: str,
    workflow_id: str,
    context: dict,
):
    return await service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=workflow_id,
        state={
            "workflow_context": {
                **context,
                "user_id": user_id,
                "creation_id": creation_id,
                "workflow_id": workflow_id,
            },
            "user_id": user_id,
            "creation_id": creation_id,
            "instructions": context["instructions"],
        },
    )


def _decode_output_image(package: dict) -> bytes:
    encoded = package.get("image_base64")
    if not isinstance(encoded, str):
        raise ValueError("The workflow did not prepare an output image.")
    image = base64.b64decode(encoded, validate=True)
    if not image or len(image) > MAX_IMAGE_BYTES:
        raise ValueError("The generated image exceeds the supported size.")
    if base64.b64encode(image).decode("ascii") != encoded:
        raise ValueError("The generated image encoding is invalid.")
    return image


def _is_resource_exhausted(error: Exception, event_error_code: str | None) -> bool:
    if event_error_code and "RESOURCE_EXHAUSTED" in event_error_code.upper():
        return True

    pending = [error]
    visited = set()
    while pending:
        current = pending.pop()
        if id(current) in visited:
            continue
        visited.add(id(current))
        if "RESOURCEEXHAUSTED" in type(current).__name__.replace("_", "").upper():
            return True
        if getattr(current, "code", None) == 429:
            return True
        if "RESOURCE_EXHAUSTED" in str(getattr(current, "status", "")).upper():
            return True
        if current.__cause__:
            pending.append(current.__cause__)
        if current.__context__:
            pending.append(current.__context__)
    return False


def _safe_error_detail(error: Exception) -> str:
    detail = str(error)
    detail = re.sub(r"https?://[^\s'\"<>]+", "[redacted-url]", detail)
    detail = re.sub(
        r"(?i)(x-goog-signature|x-goog-credential|authorization|access_token)"
        r"(=|:\s*)[^&\s,]+",
        r"\1\2[redacted]",
        detail,
    )
    return detail[:240]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield


app = FastAPI(title="Pinboard Studio ADK service", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def handle_request_validation(
    _request: Request,
    _error: RequestValidationError,
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": "The workflow request is invalid."},
    )


@app.get("/healthz")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/workflows", dependencies=[Depends(_authorize_caller)])
async def run_workflow(workflow: AgentWorkflowRequest, request: Request) -> JSONResponse:
    session = await create_scoped_session(
        session_service,
        workflow.user_id,
        workflow.creation_id,
        workflow.workflow_id,
        {
            "request_id": workflow.request_id,
            "instructions": workflow.instructions,
            "source_image_url": workflow.source_image_url,
            "source_image_content_type": workflow.source_image_content_type,
            **(
                {
                    "audio_url": workflow.audio_url,
                    "audio_content_type": workflow.audio_content_type,
                    **(
                        {"audio_transcript_override": workflow.audio_transcript}
                        if workflow.audio_transcript
                        else {}
                    ),
                }
                if workflow.audio_url
                else {}
            ),
        },
    )

    current_agent = "workflow_start"
    agent_error_code = None
    try:
        message = types.Content(
            role="user",
            parts=[
                types.Part.from_text(
                    text=(
                        "Complete the authenticated creation workflow using the trusted "
                        "workflow context. Typed instructions: "
                        f"{workflow.instructions}"
                    )
                )
            ],
        )
        async for event in runner.run_async(
            user_id=workflow.user_id,
            session_id=session.id,
            new_message=message,
        ):
            if event.author:
                current_agent = event.author
            if event.error_code:
                agent_error_code = event.error_code
                logger.error(
                    "Agent step reported an error request_id=%s agent=%s error_code=%s",
                    workflow.request_id,
                    current_agent,
                    event.error_code,
                )

        completed_session = await session_service.get_session(
            app_name=APP_NAME,
            user_id=workflow.user_id,
            session_id=workflow.workflow_id,
        )
        state = completed_session.state if completed_session else {}
        review = state.get("review_result", {})
        if review.get("approved") is not True:
            return JSONResponse(
                status_code=200,
                content={
                    "approved": False,
                    "revision_count": review.get("revision_count", 0),
                },
            )

        package = state.get("publication_package")
        if not package or package.get("approved") is not True:
            raise ValueError("The publishing agent did not prepare an approved result.")
        image = _decode_output_image(package)
        image_content_type = package.get("image_content_type")
        if image_content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise ValueError("The publishing agent returned an unsupported image type.")
        revision_count = package.get("revision_count")
        if revision_count not in (0, 1):
            raise ValueError("The publishing agent returned an invalid revision count.")

        response_body = {
            "approved": True,
            "image_base64": base64.b64encode(image).decode("ascii"),
            "image_content_type": image_content_type,
            "revision_count": revision_count,
            "caption": str(package.get("caption", ""))[:1000],
            "audio_summary": str(package.get("audio_summary", ""))[:700],
            "image_analysis": str(package.get("image_analysis", ""))[:700],
            "creative_brief": str(state.get("creative_brief", ""))[:2000],
            "audio_transcript": str(state.get("audio_transcript", ""))[:4000],
            "audio_confidence": state.get("audio_confidence"),
        }
        return JSONResponse(content=jsonable_encoder(response_body))
    except Exception as error:
        completed_session = await session_service.get_session(
            app_name=APP_NAME,
            user_id=workflow.user_id,
            session_id=workflow.workflow_id,
        )
        state = completed_session.state if completed_session else {}
        completed_stages = [
            stage
            for stage, state_key in (
                ("audio", "audio_transcript"),
                ("creative_brief", "creative_brief"),
                ("photo_analysis", "image_analysis"),
                ("image_generation", "generated_image_base64"),
                ("review", "review_result"),
                ("publication", "publication_package"),
            )
            if state.get(state_key)
        ]
        logger.error(
            "Agent workflow failed request_id=%s agent=%s error_type=%s "
            "error_code=%s completed_stages=%s resource_exhausted=%s "
            "error_detail=%s",
            workflow.request_id,
            current_agent,
            type(error).__name__,
            agent_error_code,
            ",".join(completed_stages) or "none",
            _is_resource_exhausted(error, agent_error_code),
            _safe_error_detail(error),
        )
        if _is_resource_exhausted(error, agent_error_code):
            return JSONResponse(
                status_code=429,
                content={
                    "detail": (
                        "Gemini is temporarily at capacity for this project or model. "
                        "Wait a few minutes before retrying and check Vertex AI quotas."
                    )
                },
            )
        raise HTTPException(
            status_code=502,
            detail=f"Agent workflow {workflow.request_id} could not be completed.",
        ) from None
    finally:
        try:
            await session_service.delete_session(
                app_name=APP_NAME,
                user_id=workflow.user_id,
                session_id=workflow.workflow_id,
            )
        except Exception as error:
            logger.error(
                "Agent session cleanup failed request_id=%s error_type=%s",
                workflow.request_id,
                type(error).__name__,
            )


class TranscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    user_id: str = Field(min_length=1, max_length=128)
    creation_id: str = Field(min_length=1, max_length=1500)
    audio_url: str = Field(min_length=1, max_length=4096)
    audio_content_type: str

    @field_validator("user_id", "creation_id")
    @classmethod
    def validate_document_id(cls, value: str) -> str:
        if "/" in value or value.strip() != value:
            raise ValueError("Invalid document identifier.")
        return value

    @field_validator("audio_content_type")
    @classmethod
    def validate_audio_type(cls, value: str) -> str:
        if value not in ALLOWED_AUDIO_TYPES:
            raise ValueError("Unsupported audio type.")
        return value


@app.post("/transcriptions", dependencies=[Depends(_authorize_caller)])
async def transcribe_audio(request_data: TranscriptionRequest) -> JSONResponse:
    try:
        result = await transcribe_audio_reference(
            audio_url=request_data.audio_url,
            audio_content_type=request_data.audio_content_type,
            user_id=request_data.user_id,
            creation_id=request_data.creation_id,
            request_id=request_data.request_id,
        )
        return JSONResponse(content=jsonable_encoder(result))
    except Exception as error:
        logger.error(
            "Audio transcription failed request_id=%s error_type=%s error_detail=%s",
            request_data.request_id,
            type(error).__name__,
            _safe_error_detail(error),
        )
        if _is_resource_exhausted(error, None):
            return JSONResponse(
                status_code=429,
                content={"detail": "Gemini is temporarily at capacity. Retry shortly."},
            )
        raise HTTPException(
            status_code=502,
            detail=f"Audio transcription {request_data.request_id} could not be completed.",
        ) from None

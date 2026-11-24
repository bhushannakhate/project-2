import asyncio
import logging
import time
from typing import Any

from google.cloud import logging as cloud_logging

logger = logging.getLogger("pinboard_agent.tools")
_cloud_log = None


def _get_cloud_log():
    global _cloud_log
    if _cloud_log is None:
        _cloud_log = cloud_logging.Client().logger("gemini-api-requests")
    return _cloud_log


async def _write_model_log(payload: dict[str, Any]) -> None:
    try:
        severity = "INFO" if payload["outcome"] == "success" else "ERROR"

        def write():
            _get_cloud_log().log_struct(payload, severity=severity)

        await asyncio.to_thread(write)
    except Exception as error:
        logger.error(
            "Cloud Logging write failed event=gemini_api_call error_type=%s",
            type(error).__name__,
        )


async def generate_content_with_logging(
    client: Any,
    *,
    stage: str,
    model: str,
    request_id: str | None = None,
    **request: Any,
) -> Any:
    started_at = time.perf_counter()
    outcome = "success"
    payload: dict[str, Any] = {
        "event": "gemini_api_call",
        "service": "Google Vertex AI Gemini",
        "operation": "generate_content",
        "stage": stage,
        "model": model,
    }
    if request_id:
        payload["requestId"] = request_id

    try:
        return await client.models.generate_content(model=model, **request)
    except Exception as error:
        outcome = "failure"
        payload["errorType"] = type(error).__name__
        status = getattr(error, "status", None)
        if status is not None:
            payload["providerStatus"] = str(status)[:80]
        raise
    finally:
        payload["outcome"] = outcome
        payload["durationMs"] = round((time.perf_counter() - started_at) * 1000)
        await _write_model_log(payload)

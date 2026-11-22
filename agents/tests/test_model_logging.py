import unittest
from unittest.mock import AsyncMock, patch

from agents.pinboard_agents.tools.model_logging import (
    generate_content_with_logging,
)


class FakeModels:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error

    async def generate_content(self, **request):
        if self.error:
            raise self.error
        return self.result


class FakeClient:
    def __init__(self, models):
        self.models = models


class ModelLoggingTests(unittest.IsolatedAsyncioTestCase):
    async def test_successful_model_calls_log_safe_request_metadata(self):
        log_write = AsyncMock()
        client = FakeClient(FakeModels(result={"text": "generated"}))

        with patch(
            "agents.pinboard_agents.tools.model_logging._write_model_log",
            log_write,
        ):
            result = await generate_content_with_logging(
                client,
                stage="image_generation",
                model="gemini-test",
                request_id="request-id",
                contents=["private prompt"],
            )

        self.assertEqual(result, {"text": "generated"})
        payload = log_write.await_args.args[0]
        self.assertEqual(payload["event"], "gemini_api_call")
        self.assertEqual(payload["stage"], "image_generation")
        self.assertEqual(payload["model"], "gemini-test")
        self.assertEqual(payload["outcome"], "success")
        self.assertEqual(payload["requestId"], "request-id")
        self.assertGreaterEqual(payload["durationMs"], 0)
        self.assertNotIn("contents", payload)

    async def test_failed_model_calls_are_logged_and_still_propagated(self):
        log_write = AsyncMock()
        model_error = RuntimeError("model unavailable")
        client = FakeClient(FakeModels(error=model_error))

        with patch(
            "agents.pinboard_agents.tools.model_logging._write_model_log",
            log_write,
        ):
            with self.assertRaises(RuntimeError) as raised:
                await generate_content_with_logging(
                    client,
                    stage="audio_transcription",
                    model="gemini-test",
                )

        self.assertIs(raised.exception, model_error)
        payload = log_write.await_args.args[0]
        self.assertEqual(payload["outcome"], "failure")
        self.assertEqual(payload["errorType"], "RuntimeError")


if __name__ == "__main__":
    unittest.main()

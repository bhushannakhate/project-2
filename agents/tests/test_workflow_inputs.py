import asyncio
import unittest
from types import SimpleNamespace
from uuid import uuid4

from pydantic import ValidationError

from agents.server import AgentWorkflowRequest
from agents.pinboard_agents.tools.media_tools import transcribe_user_audio


def valid_request(**overrides):
    values = {
        "request_id": str(uuid4()),
        "user_id": "firebase-user",
        "creation_id": "creation-id",
        "workflow_id": str(uuid4()),
        "instructions": "Brighten the scene.",
        "source_image_url": "https://storage.googleapis.com/bucket/signed-image",
        "source_image_content_type": "image/jpeg",
    }
    values.update(overrides)
    return AgentWorkflowRequest(**values)


class WorkflowInputTests(unittest.TestCase):
    def test_accepts_text_only(self):
        request = valid_request()
        self.assertEqual(request.instructions, "Brighten the scene.")
        self.assertIsNone(request.audio_url)
        self.assertIsNone(request.audio_content_type)

    def test_accepts_audio_only(self):
        request = valid_request(
            instructions="",
            audio_url="https://storage.googleapis.com/bucket/signed-audio",
            audio_content_type="audio/webm",
        )
        self.assertEqual(request.instructions, "")
        self.assertEqual(request.audio_content_type, "audio/webm")

    def test_accepts_text_and_audio(self):
        request = valid_request(
            audio_url="https://storage.googleapis.com/bucket/signed-audio",
            audio_content_type="audio/mpeg",
        )
        self.assertTrue(request.instructions)
        self.assertTrue(request.audio_url)

    def test_rejects_empty_input_and_incomplete_audio_reference(self):
        with self.assertRaises(ValidationError):
            valid_request(instructions="")
        with self.assertRaises(ValidationError):
            valid_request(audio_url="https://storage.googleapis.com/bucket/audio")

    def test_audio_tool_skips_cleanly_when_audio_is_absent(self):
        context = SimpleNamespace(state={"workflow_context": {}})
        result = asyncio.run(transcribe_user_audio(context))
        self.assertEqual(result["status"], "skipped_no_audio")
        self.assertEqual(result["transcription"], "")


if __name__ == "__main__":
    unittest.main()

import os
import unittest
from unittest.mock import patch

from agents.pinboard_agents.tools.media_tools import _expected_object_path


class MediaUrlScopeTests(unittest.TestCase):
    def test_signed_url_must_match_user_creation_and_media_kind(self):
        url = (
            "https://storage.googleapis.com/test-bucket/"
            "users/user-a/creations/creation-a/sourceImage/object-id"
            "?X-Goog-Signature=test"
        )
        with patch.dict(
            os.environ,
            {"MEDIA_STORAGE_BUCKET": "test-bucket", "NODE_ENV": "production"},
        ):
            self.assertEqual(
                _expected_object_path(url, "user-a", "creation-a", "sourceImage"),
                "users/user-a/creations/creation-a/sourceImage/object-id",
            )
            for user_id, creation_id in [
                ("user-b", "creation-a"),
                ("user-a", "creation-b"),
            ]:
                with self.assertRaises(ValueError):
                    _expected_object_path(
                        url,
                        user_id,
                        creation_id,
                        "sourceImage",
                    )

    def test_remote_plain_http_media_url_is_rejected(self):
        with patch.dict(os.environ, {"NODE_ENV": "development"}):
            with self.assertRaises(ValueError):
                _expected_object_path(
                    "http://storage.googleapis.com/bucket/object",
                    "user-a",
                    "creation-a",
                    "sourceImage",
                )


if __name__ == "__main__":
    unittest.main()

import unittest

from google.adk.sessions import InMemorySessionService

from agents.server import (
    APP_NAME,
    _is_resource_exhausted,
    create_scoped_session,
)


class SessionIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_sessions_are_scoped_to_user_and_creation(self):
        service = InMemorySessionService()
        workflow_a = "92f60d9c-f724-4da5-8e4a-9c2c02a30c01"
        workflow_b = "4f0a917e-f2c3-4f3f-b0a2-22f732740b77"
        user_a = "firebase-user-a"
        user_b = "firebase-user-b"
        creation_a = "creation-a"
        creation_b = "creation-b"

        session_a = await create_scoped_session(
            service,
            user_a,
            creation_a,
            workflow_a,
            {"instructions": "Edit A"},
        )
        session_b = await create_scoped_session(
            service,
            user_b,
            creation_b,
            workflow_b,
            {"instructions": "Edit B"},
        )
        stored_a = await service.get_session(
            app_name=APP_NAME,
            user_id=user_a,
            session_id=workflow_a,
        )
        stored_b = await service.get_session(
            app_name=APP_NAME,
            user_id=user_b,
            session_id=workflow_b,
        )

        self.assertNotEqual(session_a.id, session_b.id)
        self.assertEqual(stored_a.state["user_id"], user_a)
        self.assertEqual(stored_a.state["creation_id"], creation_a)
        self.assertEqual(stored_a.state["instructions"], "Edit A")
        self.assertEqual(stored_b.state["user_id"], user_b)
        self.assertEqual(stored_b.state["creation_id"], creation_b)
        self.assertEqual(stored_b.state["instructions"], "Edit B")
        self.assertIsNone(
            await service.get_session(
                app_name=APP_NAME,
                user_id=user_b,
                session_id=workflow_a,
            )
        )


class ResourceExhaustionTests(unittest.TestCase):
    def test_detects_vertex_quota_errors_without_matching_other_failures(self):
        resource_exhausted = type("_ResourceExhaustedError", (Exception,), {})
        self.assertTrue(_is_resource_exhausted(resource_exhausted(), None))
        self.assertTrue(_is_resource_exhausted(RuntimeError(), "RESOURCE_EXHAUSTED"))
        self.assertFalse(_is_resource_exhausted(RuntimeError(), None))


if __name__ == "__main__":
    unittest.main()

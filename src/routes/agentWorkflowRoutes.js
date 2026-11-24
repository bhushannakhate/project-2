import { Router } from "express";
import { postAgentWorkflow } from "../controllers/agentWorkflowController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireFirebaseUser } from "../middleware/requireFirebaseUser.js";
import { validateAgentWorkflow } from "../middleware/validateAgentWorkflow.js";

export function createAgentWorkflowRoutes(config) {
  const router = Router();

  router.post(
    "/creations/:creationId/agent-workflows",
    requireFirebaseUser,
    validateAgentWorkflow,
    asyncHandler((request, response) =>
      postAgentWorkflow(request, response, config),
    ),
  );

  return router;
}

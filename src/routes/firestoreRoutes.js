import { Router } from "express";
import {
  getCreations,
  getCurrentUser,
  getOneCreation,
  patchCreation,
  patchCurrentUser,
  postCreation,
  removeCreation,
} from "../controllers/firestoreController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireFirebaseUser } from "../middleware/requireFirebaseUser.js";
import { validateBody } from "../middleware/validateBody.js";

const router = Router();

router.get("/users/me", requireFirebaseUser, asyncHandler(getCurrentUser));
router.patch(
  "/users/me",
  requireFirebaseUser,
  validateBody,
  asyncHandler(patchCurrentUser),
);
router.get("/creations", requireFirebaseUser, asyncHandler(getCreations));
router.get(
  "/creations/:creationId",
  requireFirebaseUser,
  asyncHandler(getOneCreation),
);
router.post(
  "/creations",
  requireFirebaseUser,
  validateBody,
  asyncHandler(postCreation),
);
router.patch(
  "/creations/:creationId",
  requireFirebaseUser,
  validateBody,
  asyncHandler(patchCreation),
);
router.delete(
  "/creations/:creationId",
  requireFirebaseUser,
  asyncHandler(removeCreation),
);

export default router;

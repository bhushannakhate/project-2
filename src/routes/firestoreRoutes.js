import { Router } from "express";
import {
  getCreations,
  getCurrentUser,
  getOneCreation,
  getMediaDownloadUrl,
  patchCreation,
  patchCurrentUser,
  postCreation,
  postCompleteMediaUpload,
  postMediaUpload,
  removeCreation,
} from "../controllers/firestoreController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireFirebaseUser } from "../middleware/requireFirebaseUser.js";
import {
  validateCreation,
  validateCreationQuery,
} from "../middleware/validateCreation.js";
import { validateBody } from "../middleware/validateBody.js";
import {
  validateMediaKind,
  validateMediaUpload,
} from "../middleware/validateMediaUpload.js";

const router = Router();

router.get("/users/me", requireFirebaseUser, asyncHandler(getCurrentUser));
router.patch(
  "/users/me",
  requireFirebaseUser,
  validateBody,
  asyncHandler(patchCurrentUser),
);
router.get(
  "/creations",
  requireFirebaseUser,
  validateCreationQuery,
  asyncHandler(getCreations),
);
router.get(
  "/creations/:creationId",
  requireFirebaseUser,
  asyncHandler(getOneCreation),
);
router.post(
  "/creations",
  requireFirebaseUser,
  validateBody,
  validateCreation(),
  asyncHandler(postCreation),
);
router.patch(
  "/creations/:creationId",
  requireFirebaseUser,
  validateBody,
  validateCreation({ partial: true }),
  asyncHandler(patchCreation),
);
router.delete(
  "/creations/:creationId",
  requireFirebaseUser,
  asyncHandler(removeCreation),
);
router.post(
  "/creations/:creationId/media/:mediaKind/uploads",
  requireFirebaseUser,
  validateMediaKind,
  validateBody,
  validateMediaUpload,
  asyncHandler(postMediaUpload),
);
router.post(
  "/creations/:creationId/media/uploads/:uploadId/complete",
  requireFirebaseUser,
  asyncHandler(postCompleteMediaUpload),
);
router.get(
  "/creations/:creationId/media/:mediaKind/download-url",
  requireFirebaseUser,
  validateMediaKind,
  asyncHandler(getMediaDownloadUrl),
);

export default router;

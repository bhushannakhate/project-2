import { Router } from "express";
import {
  getCreations,
  getCurrentUser,
  getGooglePhotosPickerItems,
  getGooglePhotosPickerSession,
  getGooglePhotosStatus,
  getOneCreation,
  getMediaDownloadUrl,
  patchCreation,
  patchCurrentUser,
  postCreation,
  postCompleteMediaUpload,
  postMediaUpload,
  postGooglePhotosAuthorization,
  postGooglePhotosImport,
  postGooglePhotosPickerSession,
  removeCreation,
  deleteGooglePhotosConnection,
  deleteGooglePhotosPicker,
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
router.get(
  "/google-photos/connection",
  requireFirebaseUser,
  asyncHandler(getGooglePhotosStatus),
);
router.post(
  "/google-photos/oauth/authorize",
  requireFirebaseUser,
  asyncHandler(postGooglePhotosAuthorization),
);
router.delete(
  "/google-photos/connection",
  requireFirebaseUser,
  asyncHandler(deleteGooglePhotosConnection),
);
router.post(
  "/creations/:creationId/google-photos/sessions",
  requireFirebaseUser,
  asyncHandler(postGooglePhotosPickerSession),
);
router.get(
  "/google-photos/sessions/:sessionId",
  requireFirebaseUser,
  asyncHandler(getGooglePhotosPickerSession),
);
router.get(
  "/google-photos/sessions/:sessionId/media-items",
  requireFirebaseUser,
  asyncHandler(getGooglePhotosPickerItems),
);
router.delete(
  "/google-photos/sessions/:sessionId",
  requireFirebaseUser,
  asyncHandler(deleteGooglePhotosPicker),
);
router.post(
  "/creations/:creationId/google-photos/sessions/:sessionId/import",
  requireFirebaseUser,
  validateBody,
  asyncHandler(postGooglePhotosImport),
);
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

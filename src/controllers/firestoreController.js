import {
  createCreation,
  deleteCreation,
  getCreation,
  getOrCreateUser,
  InvalidCreationCursorError,
  listCreations,
  updateCreation,
  updateUser,
} from "../services/firestoreService.js";
import { getFirebase } from "../config/firebase.js";
import { loadConfig } from "../config/env.js";
import { ApiError } from "../middleware/errorHandler.js";
import { isAdminUser } from "../services/adminAccessService.js";
import {
  completeMediaUpload,
  createMediaDownloadUrl,
  createMediaUpload,
  deleteCreationMedia,
} from "../services/mediaStorageService.js";
import {
  completeGooglePhotosAuthorization,
  createGooglePhotosAuthorization,
  createGooglePhotosPickerSession,
  deleteGooglePhotosPickerSession,
  deleteGooglePhotosPickerSessionsForCreation,
  disconnectGooglePhotos,
  getGooglePhotosConnectionStatus,
  importGooglePhotosPickerItem,
  listGooglePhotosPickerItems,
  pollGooglePhotosPickerSession,
} from "../services/googlePhotosService.js";

export async function getCurrentUser(request, response) {
  const { firestore } = getFirebase();
  const snapshot = await getOrCreateUser(firestore, request.firebaseUser);
  response.json({
    user: { id: snapshot.id, ...snapshot.data() },
    isAdmin: isAdminUser(request.firebaseUser, loadConfig().adminEmails),
  });
}

export async function patchCurrentUser(request, response) {
  const { firestore } = getFirebase();
  await updateUser(firestore, request.firebaseUser.uid, request.body);
  const snapshot = await getOrCreateUser(firestore, request.firebaseUser);
  response.json({ user: { id: snapshot.id, ...snapshot.data() } });
}

export async function getCreations(request, response) {
  const { firestore } = getFirebase();
  let result;
  try {
    const { cursor, ...query } = request.creationQuery;
    result = await listCreations(firestore, request.firebaseUser.uid, {
      ...query,
      startAfter: cursor,
    });
  } catch (error) {
    if (error instanceof InvalidCreationCursorError) {
      throw new ApiError(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }
  response.json(result);
}

export async function getOneCreation(request, response) {
  const { firestore } = getFirebase();
  const creation = await getCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
  );
  if (!creation) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }
  response.json({ creation });
}

export async function postCreation(request, response) {
  const { firestore } = getFirebase();
  const snapshot = await createCreation(
    firestore,
    request.firebaseUser.uid,
    request.creation,
  );
  response
    .status(201)
    .json({ creation: { id: snapshot.id, ...snapshot.data() } });
}

export async function patchCreation(request, response) {
  const { firestore } = getFirebase();
  const creation = await getCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
  );
  if (!creation) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }

  await updateCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
    request.creation,
  );
  const updated = await getCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
  );
  response.json({ creation: updated });
}

export async function removeCreation(request, response) {
  const { bucket, firestore } = getFirebase();
  const creation = await getCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
  );
  if (!creation) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }
  await deleteGooglePhotosPickerSessionsForCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
    loadConfig(),
  );
  await deleteCreationMedia(
    firestore,
    bucket,
    request.firebaseUser.uid,
    request.params.creationId,
  );
  await deleteCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
  );
  response
    .status(200)
    .json({ message: "Creation deleted.", id: request.params.creationId });
}

export async function postMediaUpload(request, response) {
  const { bucket, firestore } = getFirebase();
  const userId = request.firebaseUser.uid;
  const { creationId, mediaKind } = request.params;
  if (!(await getCreation(firestore, userId, creationId))) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }

  const upload = await createMediaUpload(
    firestore,
    bucket,
    userId,
    creationId,
    mediaKind,
    request.mediaUpload,
  );
  response.status(201).json({ upload });
}

export async function postCompleteMediaUpload(request, response) {
  const { bucket, firestore } = getFirebase();
  const media = await completeMediaUpload(
    firestore,
    bucket,
    request.firebaseUser.uid,
    request.params.creationId,
    request.params.uploadId,
  );
  if (!media) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Upload is missing, expired, invalid, or does not belong to this creation.",
    );
  }
  response.json({ media });
}

export async function getMediaDownloadUrl(request, response) {
  const { bucket, firestore } = getFirebase();
  const userId = request.firebaseUser.uid;
  const creation = await getCreation(
    firestore,
    userId,
    request.params.creationId,
  );
  if (!creation) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }

  const download = await createMediaDownloadUrl(
    bucket,
    userId,
    request.params.creationId,
    request.params.mediaKind,
    creation,
  );
  if (!download) {
    throw new ApiError(404, "NOT_FOUND", "Media not found.");
  }
  response.json(download);
}

export async function getGooglePhotosStatus(request, response) {
  const { firestore } = getFirebase();
  const status = await getGooglePhotosConnectionStatus(
    firestore,
    request.firebaseUser.uid,
    loadConfig(),
  );
  response.json(status);
}

export async function postGooglePhotosAuthorization(request, response) {
  const { firestore } = getFirebase();
  const config = loadConfig();
  const result = await createGooglePhotosAuthorization(
    firestore,
    request.firebaseUser.uid,
    request.get("origin"),
    config,
    config.allowedOrigins,
  );
  response.json(result);
}

export async function getGooglePhotosOAuthCallback(request, response) {
  const { firestore } = getFirebase();
  const result = await completeGooglePhotosAuthorization(
    firestore,
    {
      code: request.query.code,
      state: request.query.state,
      providerError: request.query.error,
    },
    loadConfig(),
  );
  const redirect = new URL("/", result.origin);
  redirect.searchParams.set("googlePhotos", result.status);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.redirect(303, redirect.toString());
}

export async function deleteGooglePhotosConnection(request, response) {
  const { firestore } = getFirebase();
  const result = await disconnectGooglePhotos(
    firestore,
    request.firebaseUser.uid,
    loadConfig(),
  );
  response.json(result);
}

export async function postGooglePhotosPickerSession(request, response) {
  const { firestore } = getFirebase();
  const userId = request.firebaseUser.uid;
  const { creationId } = request.params;
  if (!(await getCreation(firestore, userId, creationId))) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }
  const session = await createGooglePhotosPickerSession(
    firestore,
    userId,
    creationId,
    loadConfig(),
  );
  response.status(201).json({ session });
}

export async function getGooglePhotosPickerSession(request, response) {
  const { firestore } = getFirebase();
  const result = await pollGooglePhotosPickerSession(
    firestore,
    request.firebaseUser.uid,
    request.params.sessionId,
    loadConfig(),
  );
  response.json(result);
}

export async function getGooglePhotosPickerItems(request, response) {
  const { firestore } = getFirebase();
  const result = await listGooglePhotosPickerItems(
    firestore,
    request.firebaseUser.uid,
    request.params.sessionId,
    loadConfig(),
  );
  response.json(result);
}

export async function deleteGooglePhotosPicker(request, response) {
  const { firestore } = getFirebase();
  const result = await deleteGooglePhotosPickerSession(
    firestore,
    request.firebaseUser.uid,
    request.params.sessionId,
    loadConfig(),
  );
  response.json(result);
}

export async function postGooglePhotosImport(request, response) {
  const unexpected = Object.keys(request.body || {}).find(
    (key) => key !== "mediaItemId",
  );
  if (
    unexpected ||
    typeof request.body?.mediaItemId !== "string" ||
    request.body.mediaItemId.length < 1 ||
    request.body.mediaItemId.length > 512
  ) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Provide a selected Google Photos mediaItemId.",
    );
  }

  const { bucket, firestore } = getFirebase();
  const userId = request.firebaseUser.uid;
  if (!(await getCreation(firestore, userId, request.params.creationId))) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }
  const media = await importGooglePhotosPickerItem(
    firestore,
    bucket,
    userId,
    request.params.creationId,
    request.params.sessionId,
    request.body.mediaItemId,
    loadConfig(),
  );
  response.json({ media });
}

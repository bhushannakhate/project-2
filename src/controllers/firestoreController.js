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
import { ApiError } from "../middleware/errorHandler.js";
import {
  completeMediaUpload,
  createMediaDownloadUrl,
  createMediaUpload,
  deleteCreationMedia,
} from "../services/mediaStorageService.js";

export async function getCurrentUser(request, response) {
  const { firestore } = getFirebase();
  const snapshot = await getOrCreateUser(firestore, request.firebaseUser);
  response.json({ user: { id: snapshot.id, ...snapshot.data() } });
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

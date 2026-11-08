import {
  createCreation,
  deleteCreation,
  getCreation,
  getOrCreateUser,
  listCreations,
  updateCreation,
  updateUser,
} from "../services/firestoreService.js";
import { ApiError } from "../middleware/errorHandler.js";
import { getFirebase } from "../config/firebase.js";

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
  const limit = Math.min(
    Math.max(Number.parseInt(request.query.limit, 10) || 20, 1),
    100,
  );
  const result = await listCreations(firestore, request.firebaseUser.uid, {
    status:
      typeof request.query.status === "string"
        ? request.query.status
        : undefined,
    limit,
    startAfter: request.query.cursor,
  });
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
  const allowedFields = [
    "sourceImageUrl",
    "instructions",
    "audioUrl",
    "status",
    "metadata",
  ];
  const input = Object.fromEntries(
    Object.entries(request.body).filter(([key]) => allowedFields.includes(key)),
  );
  const snapshot = await createCreation(
    firestore,
    request.firebaseUser.uid,
    input,
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

  const allowedFields = [
    "sourceImageUrl",
    "outputImageUrl",
    "instructions",
    "audioUrl",
    "status",
    "metadata",
    "pinterest",
  ];
  const changes = Object.fromEntries(
    Object.entries(request.body).filter(([key]) => allowedFields.includes(key)),
  );
  await updateCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
    changes,
  );
  const updated = await getCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
  );
  response.json({ creation: updated });
}

export async function removeCreation(request, response) {
  const { firestore } = getFirebase();
  const creation = await getCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
  );
  if (!creation) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }
  await deleteCreation(
    firestore,
    request.firebaseUser.uid,
    request.params.creationId,
  );
  response
    .status(200)
    .json({ message: "Creation deleted.", id: request.params.creationId });
}

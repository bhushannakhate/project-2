import express from "express";

import { getFirebase } from "./firebase.js";
import {
  createCreation,
  deleteCreation,
  getCreation,
  getOrCreateUser,
  listCreations,
  updateCreation,
  updateUser,
} from "./firestoreRepositories.js";

const router = express.Router();

async function requireFirebaseUser(request, response, next) {
  try {
    const authorization = request.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return response
        .status(401)
        .json({ error: "A Firebase bearer token is required." });
    }
    const { auth } = getFirebase();
    request.firebaseUser = await auth.verifyIdToken(authorization.slice(7));
    next();
  } catch (error) {
    console.error(
      "Firebase token verification failed:",
      error.code || error.message,
    );
    return response
      .status(401)
      .json({ error: "The Firebase identity token is invalid or expired." });
  }
}

router.use(requireFirebaseUser);

router.get("/users/me", async (request, response, next) => {
  try {
    const { firestore } = getFirebase();
    const snapshot = await getOrCreateUser(firestore, request.firebaseUser);
    response.json({ user: { id: snapshot.id, ...snapshot.data() } });
  } catch (error) {
    next(error);
  }
});

router.patch("/users/me", async (request, response, next) => {
  try {
    const { firestore } = getFirebase();
    await updateUser(firestore, request.firebaseUser.uid, request.body);
    const snapshot = await getOrCreateUser(firestore, request.firebaseUser);
    response.json({ user: { id: snapshot.id, ...snapshot.data() } });
  } catch (error) {
    next(error);
  }
});

router.get("/creations", async (request, response, next) => {
  try {
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
  } catch (error) {
    next(error);
  }
});

router.get("/creations/:creationId", async (request, response, next) => {
  try {
    const { firestore } = getFirebase();
    const creation = await getCreation(
      firestore,
      request.firebaseUser.uid,
      request.params.creationId,
    );
    if (!creation)
      return response.status(404).json({ error: "Creation not found." });
    response.json({ creation });
  } catch (error) {
    next(error);
  }
});

router.post("/creations", async (request, response, next) => {
  try {
    const { firestore } = getFirebase();
    const allowedFields = [
      "sourceImageUrl",
      "instructions",
      "audioUrl",
      "status",
      "metadata",
    ];
    const input = Object.fromEntries(
      Object.entries(request.body).filter(([key]) =>
        allowedFields.includes(key),
      ),
    );
    const snapshot = await createCreation(
      firestore,
      request.firebaseUser.uid,
      input,
    );
    response
      .status(201)
      .json({ creation: { id: snapshot.id, ...snapshot.data() } });
  } catch (error) {
    next(error);
  }
});

router.patch("/creations/:creationId", async (request, response, next) => {
  try {
    const { firestore } = getFirebase();
    const creation = await getCreation(
      firestore,
      request.firebaseUser.uid,
      request.params.creationId,
    );
    if (!creation)
      return response.status(404).json({ error: "Creation not found." });
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
      Object.entries(request.body).filter(([key]) =>
        allowedFields.includes(key),
      ),
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
  } catch (error) {
    next(error);
  }
});

router.delete("/creations/:creationId", async (request, response, next) => {
  try {
    const { firestore } = getFirebase();
    const creation = await getCreation(
      firestore,
      request.firebaseUser.uid,
      request.params.creationId,
    );
    if (!creation)
      return response.status(404).json({ error: "Creation not found." });
    await deleteCreation(
      firestore,
      request.firebaseUser.uid,
      request.params.creationId,
    );
    response
      .status(200)
      .json({ message: "Creation deleted.", id: request.params.creationId });
  } catch (error) {
    next(error);
  }
});

export default router;

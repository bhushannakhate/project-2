import { FieldValue } from "firebase-admin/firestore";

export const CREATIONS_COLLECTION = "creations";

export class InvalidCreationCursorError extends Error {
  constructor() {
    super("cursor does not identify a creation owned by this user.");
    this.name = "InvalidCreationCursorError";
  }
}

function userDocument(firestore, userId) {
  return firestore.collection("users").doc(userId);
}

export async function getOrCreateUser(firestore, user) {
  const reference = userDocument(firestore, user.uid);
  const snapshot = await reference.get();
  const now = FieldValue.serverTimestamp();

  if (!snapshot.exists) {
    await reference.set({
      uid: user.uid,
      email: user.email || "",
      displayName: user.name || "",
      photoURL: user.picture || "",
      credits: 0,
      subscription: "free",
      pinterest: { connected: false },
      createdAt: now,
      updatedAt: now,
    });
  }

  return reference.get();
}

export function updateUser(firestore, userId, changes) {
  const allowed = ["displayName", "photoURL"];
  const update = Object.fromEntries(
    Object.entries(changes).filter(([key]) => allowed.includes(key)),
  );
  update.updatedAt = FieldValue.serverTimestamp();
  return userDocument(firestore, userId).set(update, { merge: true });
}

export async function listCreations(
  firestore,
  userId,
  { status, limit = 20, startAfter },
) {
  let query = userDocument(firestore, userId)
    .collection(CREATIONS_COLLECTION)
    .where("isDeleted", "==", false)
    .orderBy("createdAt", "desc")
    .limit(limit + 1);

  if (status) query = query.where("status", "==", status);
  if (startAfter) {
    const cursorSnapshot = await userDocument(firestore, userId)
      .collection(CREATIONS_COLLECTION)
      .doc(startAfter)
      .get();
    if (!cursorSnapshot.exists) {
      throw new InvalidCreationCursorError();
    }
    query = query.startAfter(cursorSnapshot);
  }

  const snapshot = await query.get();
  const hasMore = snapshot.docs.length > limit;
  const page = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;
  return {
    creations: page.map((document) => ({
      id: document.id,
      ...document.data(),
    })),
    nextCursor: hasMore ? page.at(-1).id : null,
  };
}

export async function getCreation(firestore, userId, creationId) {
  const snapshot = await userDocument(firestore, userId)
    .collection(CREATIONS_COLLECTION)
    .doc(creationId)
    .get();
  if (!snapshot.exists || snapshot.data().isDeleted) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

export async function createCreation(firestore, userId, input) {
  const reference = userDocument(firestore, userId)
    .collection(CREATIONS_COLLECTION)
    .doc();
  await reference.set({
    ...input,
    userId,
    revisionCount: 0,
    status: input.status || "draft",
    isDeleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return reference.get();
}

export function updateCreation(firestore, userId, creationId, changes) {
  return userDocument(firestore, userId)
    .collection(CREATIONS_COLLECTION)
    .doc(creationId)
    .update({ ...changes, updatedAt: FieldValue.serverTimestamp() });
}

export function deleteCreation(firestore, userId, creationId) {
  return userDocument(firestore, userId)
    .collection(CREATIONS_COLLECTION)
    .doc(creationId)
    .update({
      isDeleted: true,
      deletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

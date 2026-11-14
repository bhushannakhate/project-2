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
  { status, limit = 20, startAfter, search, from, to },
) {
  let query = userDocument(firestore, userId)
    .collection(CREATIONS_COLLECTION)
    .where("isDeleted", "==", false)
    .orderBy("createdAt", "desc");

  if (status) query = query.where("status", "==", status);

  const requiresPostFiltering = Boolean(search || from || to);
  if (!requiresPostFiltering) {
    query = query.limit(limit + 1);
  }

  if (startAfter) {
    if (requiresPostFiltering) {
      const snapshot = await query.get();
      const filtered = filterCreations(snapshot.docs, { search, from, to });
      const cursorIndex = filtered.findIndex(
        (document) => document.id === startAfter,
      );
      if (cursorIndex < 0) throw new InvalidCreationCursorError();
      return formatCreationPage(filtered.slice(cursorIndex + 1), limit);
    }

    const cursorSnapshot = await userDocument(firestore, userId)
      .collection(CREATIONS_COLLECTION)
      .doc(startAfter)
      .get();
    if (!cursorSnapshot.exists) throw new InvalidCreationCursorError();
    query = query.startAfter(cursorSnapshot);
  }

  const snapshot = await query.get();
  const documents = requiresPostFiltering
    ? filterCreations(snapshot.docs, { search, from, to })
    : snapshot.docs;
  return formatCreationPage(documents, limit);
}

function filterCreations(documents, { search, from, to }) {
  const searchTerms = search?.toLowerCase().split(/\s+/).filter(Boolean);
  const fromTime = from ? Date.parse(`${from}T00:00:00.000Z`) : null;
  const toTime = to ? Date.parse(`${to}T23:59:59.999Z`) : null;

  return documents.filter((document) => {
    const data = document.data();
    const creationTime = toMillis(data.createdAt);
    if (
      fromTime !== null &&
      (creationTime === null || creationTime < fromTime)
    ) {
      return false;
    }
    if (toTime !== null && (creationTime === null || creationTime > toTime)) {
      return false;
    }
    if (!searchTerms?.length) return true;

    const searchableText = [
      document.id,
      data.instructions,
      data.status,
      data.sourceImageUrl,
      data.outputImageUrl,
      data.audioUrl,
      data.metadata && JSON.stringify(data.metadata),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchTerms.every((term) => searchableText.includes(term));
  });
}

function formatCreationPage(documents, limit) {
  const hasMore = documents.length > limit;
  const page = hasMore ? documents.slice(0, limit) : documents;
  return {
    creations: page.map((document) => ({
      id: document.id,
      ...document.data(),
    })),
    nextCursor: hasMore ? page.at(-1).id : null,
  };
}

function toMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
    media: {},
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

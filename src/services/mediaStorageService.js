import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  InvalidImageError,
  normalizeImageBuffer,
} from "../models/imageValidation.js";
import { MEDIA_KINDS } from "../models/mediaValidation.js";

const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;
const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;

function creationReference(firestore, userId, creationId) {
  return firestore
    .collection("users")
    .doc(userId)
    .collection("creations")
    .doc(creationId);
}

function sessionCollection(firestore, userId) {
  return firestore
    .collection("users")
    .doc(userId)
    .collection("mediaUploadSessions");
}

function mediaPath(userId, creationId, mediaKind, uploadId) {
  return `users/${userId}/creations/${creationId}/${mediaKind}/${uploadId}`;
}

export async function createMediaUpload(
  firestore,
  bucket,
  userId,
  creationId,
  mediaKind,
  { contentType, sizeBytes },
) {
  const uploadId = randomUUID();
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MS);
  const stagingPath = `staging/${userId}/${creationId}/${uploadId}`;
  const session = {
    creationId,
    mediaKind,
    contentType,
    sizeBytes,
    stagingPath,
    status: "pending",
    expiresAt: Timestamp.fromDate(expiresAt),
    createdAt: FieldValue.serverTimestamp(),
  };

  await sessionCollection(firestore, userId).doc(uploadId).set(session);
  try {
    const emulatorHost = process.env.STORAGE_EMULATOR_HOST;
    const [signedUrl] = emulatorHost
      ? [
          `${emulatorHost}/v0/b/${encodeURIComponent(bucket.name)}/o?uploadType=media&name=${encodeURIComponent(stagingPath)}`,
        ]
      : await bucket.file(stagingPath).getSignedUrl({
          version: "v4",
          action: "write",
          expires: expiresAt,
          contentType,
        });
    return {
      uploadId,
      uploadUrl: signedUrl,
      method: emulatorHost ? "POST" : "PUT",
      headers: { "Content-Type": contentType },
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    await sessionCollection(firestore, userId).doc(uploadId).delete();
    throw error;
  }
}

export async function completeMediaUpload(
  firestore,
  bucket,
  userId,
  creationId,
  uploadId,
) {
  if (!/^[\da-f-]{36}$/i.test(uploadId)) return null;

  const sessionReference = sessionCollection(firestore, userId).doc(uploadId);
  const sessionSnapshot = await sessionReference.get();
  if (!sessionSnapshot.exists) return null;
  const session = sessionSnapshot.data();
  if (
    session.creationId !== creationId ||
    !MEDIA_KINDS.has(session.mediaKind)
  ) {
    return null;
  }
  if (session.status === "completed" && session.mediaReference) {
    return session.mediaReference;
  }
  if (session.expiresAt.toDate() <= new Date()) {
    await bucket.file(session.stagingPath).delete({ ignoreNotFound: true });
    await sessionReference.delete();
    return null;
  }

  const stagedFile = bucket.file(session.stagingPath);
  const [exists] = await stagedFile.exists();
  if (!exists) return null;

  const [metadata] = await stagedFile.getMetadata();
  const actualSize = Number(metadata.size);
  if (
    actualSize !== session.sizeBytes ||
    metadata.contentType !== session.contentType
  ) {
    await stagedFile.delete({ ignoreNotFound: true });
    await sessionReference.delete();
    return null;
  }

  let normalizedImage;
  if (
    session.mediaKind === "sourceImage" ||
    session.mediaKind === "outputImage"
  ) {
    const [imageBuffer] = await stagedFile.download();
    try {
      normalizedImage = await normalizeImageBuffer(
        imageBuffer,
        session.contentType,
      );
    } catch (error) {
      if (!(error instanceof InvalidImageError)) throw error;
      await stagedFile.delete({ ignoreNotFound: true });
      await sessionReference.delete();
      return null;
    }
  }

  const objectPath = mediaPath(userId, creationId, session.mediaKind, uploadId);
  const destination = bucket.file(objectPath);
  const finalContentType = normalizedImage?.contentType ?? session.contentType;
  const finalSizeBytes = normalizedImage?.sizeBytes ?? actualSize;
  const finalMetadata = {
    contentType: finalContentType,
    cacheControl: "private, no-store",
    metadata: {
      ownerUid: userId,
      creationId,
      mediaKind: session.mediaKind,
    },
  };
  if (normalizedImage) {
    await destination.save(normalizedImage.buffer, {
      resumable: false,
      metadata: finalMetadata,
    });
  } else {
    await stagedFile.copy(destination);
    await destination.setMetadata(finalMetadata);
  }

  const reference = {
    objectPath,
    contentType: finalContentType,
    sizeBytes: finalSizeBytes,
    ...(normalizedImage
      ? { width: normalizedImage.width, height: normalizedImage.height }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  const creation = creationReference(firestore, userId, creationId);
  const existingCreation = await creation.get();
  if (!existingCreation.exists || existingCreation.data().isDeleted) {
    await destination.delete({ ignoreNotFound: true });
    await stagedFile.delete({ ignoreNotFound: true });
    await sessionReference.delete();
    return null;
  }

  const previous = existingCreation.data().media?.[session.mediaKind];
  try {
    await creation.update({
      [`media.${session.mediaKind}`]: reference,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    await destination.delete({ ignoreNotFound: true });
    throw error;
  }

  if (
    previous?.objectPath &&
    previous.objectPath.startsWith(
      `users/${userId}/creations/${creationId}/${session.mediaKind}/`,
    )
  ) {
    await bucket.file(previous.objectPath).delete({ ignoreNotFound: true });
  }

  await stagedFile.delete({ ignoreNotFound: true });
  await sessionReference.delete();
  return reference;
}

export async function discardMediaUpload(firestore, bucket, userId, uploadId) {
  if (!/^[\da-f-]{36}$/i.test(uploadId)) return;

  const sessionReference = sessionCollection(firestore, userId).doc(uploadId);
  const sessionSnapshot = await sessionReference.get();
  if (!sessionSnapshot.exists) return;
  const session = sessionSnapshot.data();
  await bucket.file(session.stagingPath).delete({ ignoreNotFound: true });
  await sessionReference.delete();
}

export async function createMediaDownloadUrl(
  bucket,
  userId,
  creationId,
  mediaKind,
  creation,
) {
  if (!MEDIA_KINDS.has(mediaKind)) return null;
  const reference = creation.media?.[mediaKind];
  const expectedPrefix = `users/${userId}/creations/${creationId}/${mediaKind}/`;
  if (!reference?.objectPath?.startsWith(expectedPrefix)) return null;

  const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_MS);
  const file = bucket.file(reference.objectPath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const emulatorHost = process.env.STORAGE_EMULATOR_HOST;
  const [downloadUrl] = emulatorHost
    ? [
        `${emulatorHost}/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(reference.objectPath)}?alt=media`,
      ]
    : await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: expiresAt,
      });
  return { downloadUrl, expiresAt: expiresAt.toISOString() };
}

export async function deleteCreationMedia(
  firestore,
  bucket,
  userId,
  creationId,
) {
  const sessions = await sessionCollection(firestore, userId)
    .where("creationId", "==", creationId)
    .get();
  const prefixes = [
    `staging/${userId}/${creationId}/`,
    `users/${userId}/creations/${creationId}/`,
  ];

  for (const prefix of prefixes) {
    const [files] = await bucket.getFiles({ prefix });
    await Promise.all(
      files.map((file) => file.delete({ ignoreNotFound: true })),
    );
  }
  await Promise.all(sessions.docs.map((document) => document.ref.delete()));
}

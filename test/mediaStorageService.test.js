import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { completeMediaUpload } from "../src/services/mediaStorageService.js";

function createStorageHarness({ imageBuffer, contentType = "image/png" }) {
  const userId = "test-user";
  const creationId = "test-creation";
  const uploadId = randomUUID();
  const stagingPath = `staging/${userId}/${creationId}/${uploadId}`;
  const destinationPath = `users/${userId}/creations/${creationId}/sourceImage/${uploadId}`;
  const session = {
    creationId,
    mediaKind: "sourceImage",
    contentType,
    sizeBytes: imageBuffer.length,
    stagingPath,
    status: "pending",
    expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
  };
  const state = {
    stagedBytes: imageBuffer,
    stagedDeleted: false,
    destinationBytes: null,
    destinationMetadata: null,
    sessionDeleted: false,
    creationUpdate: null,
  };

  const firestore = {
    collection: (collectionName) => ({
      doc: (documentId) => ({
        collection: (subcollectionName) => {
          if (
            collectionName === "users" &&
            subcollectionName === "mediaUploadSessions"
          ) {
            return {
              doc: (sessionId) => ({
                get: async () => ({
                  exists: documentId === userId && sessionId === uploadId,
                  data: () => session,
                }),
                delete: async () => {
                  state.sessionDeleted = true;
                },
              }),
            };
          }
          if (collectionName === "users" && subcollectionName === "creations") {
            return {
              doc: (creationDocumentId) => ({
                get: async () => ({
                  exists:
                    documentId === userId && creationDocumentId === creationId,
                  data: () => ({ media: {} }),
                }),
                update: async (value) => {
                  state.creationUpdate = value;
                },
              }),
            };
          }
          throw new Error(
            `Unexpected Firestore collection: ${subcollectionName}`,
          );
        },
      }),
    }),
  };

  const bucket = {
    file: (path) => {
      if (path === stagingPath) {
        return {
          exists: async () => [!state.stagedDeleted],
          getMetadata: async () => [
            {
              size: String(state.stagedBytes.length),
              contentType,
            },
          ],
          download: async () => [state.stagedBytes],
          delete: async () => {
            state.stagedDeleted = true;
          },
        };
      }
      assert.equal(path, destinationPath);
      return {
        save: async (buffer, options) => {
          state.destinationBytes = buffer;
          state.destinationMetadata = options.metadata;
        },
        delete: async () => {
          state.destinationBytes = null;
        },
      };
    },
  };

  return {
    firestore,
    bucket,
    state,
    userId,
    creationId,
    uploadId,
    destinationPath,
    complete: () =>
      completeMediaUpload(firestore, bucket, userId, creationId, uploadId),
  };
}

async function createPng() {
  return sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: "#ad5a4d",
    },
  })
    .png()
    .toBuffer();
}

test("media completion stores normalized image bytes and image dimensions", async () => {
  const harness = createStorageHarness({ imageBuffer: await createPng() });

  const media = await harness.complete();
  const storedMetadata = await sharp(harness.state.destinationBytes).metadata();

  assert.equal(media.objectPath, harness.destinationPath);
  assert.equal(media.contentType, "image/png");
  assert.equal(media.width, 4);
  assert.equal(media.height, 3);
  assert.equal(media.sizeBytes, harness.state.destinationBytes.length);
  assert.equal(storedMetadata.width, 4);
  assert.equal(storedMetadata.height, 3);
  assert.deepEqual(harness.state.creationUpdate["media.sourceImage"], media);
  assert.equal(harness.state.stagedDeleted, true);
  assert.equal(harness.state.sessionDeleted, true);
});

test("media completion removes corrupt source image data without attaching it", async () => {
  const harness = createStorageHarness({
    imageBuffer: Buffer.from("not actually a png"),
  });

  const media = await harness.complete();

  assert.equal(media, null);
  assert.equal(harness.state.destinationBytes, null);
  assert.equal(harness.state.creationUpdate, null);
  assert.equal(harness.state.stagedDeleted, true);
  assert.equal(harness.state.sessionDeleted, true);
});

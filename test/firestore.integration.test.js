import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import sharp from "sharp";

const emulatorEnabled = Boolean(
  process.env.FIREBASE_AUTH_EMULATOR_HOST &&
  process.env.FIRESTORE_EMULATOR_HOST &&
  process.env.FIREBASE_STORAGE_EMULATOR_HOST,
);

test(
  "authenticated creation CRUD is UID-scoped, validated, paginated, and soft-deleted",
  {
    skip:
      !emulatorEnabled && "Run with the Firebase Auth and Firestore emulators.",
  },
  async () => {
    process.env.FIREBASE_PROJECT_ID =
      process.env.GCLOUD_PROJECT || "demo-project-2";
    process.env.MEDIA_STORAGE_BUCKET = `${process.env.GCLOUD_PROJECT || "demo-project-2"}.appspot.com`;
    const [{ createApp }, { getFirebase }] = await Promise.all([
      import("../src/app.js"),
      import("../src/config/firebase.js"),
    ]);

    const config = {
      port: 4000,
      nodeEnv: "test",
      allowedOrigins: ["http://localhost:5173"],
      demoCustomersEnabled: false,
      firebaseProjectId: process.env.GCLOUD_PROJECT || "demo-project-2",
      mediaStorageBucket: process.env.MEDIA_STORAGE_BUCKET,
    };
    const server = createApp({ config }).listen(0);
    await once(server, "listening");
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const { auth, bucket, firestore } = getFirebase();
    const users = [];

    async function createEmulatorUser() {
      const email = `creation-test-${crypto.randomUUID()}@example.test`;
      const response = await fetch(
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            password: "Test-Password-938!",
            returnSecureToken: true,
          }),
        },
      );
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      users.push(result.localId);
      return result;
    }

    async function api(user, path, options = {}) {
      const headers = {
        authorization: `Bearer ${user.idToken}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      };
      return fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    }

    try {
      const owner = await createEmulatorUser();
      const otherUser = await createEmulatorUser();

      const unauthenticated = await fetch(`${baseUrl}/api/creations`);
      assert.equal(unauthenticated.status, 401);
      const unauthenticatedItem = await fetch(
        `${baseUrl}/api/creations/unknown`,
      );
      assert.equal(unauthenticatedItem.status, 401);
      const unauthenticatedCreate = await fetch(`${baseUrl}/api/creations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceImageUrl: "https://storage.example/unauthenticated.png",
        }),
      });
      assert.equal(unauthenticatedCreate.status, 401);
      const unauthenticatedPatch = await fetch(
        `${baseUrl}/api/creations/unknown`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "failed" }),
        },
      );
      assert.equal(unauthenticatedPatch.status, 401);
      const unauthenticatedDelete = await fetch(
        `${baseUrl}/api/creations/unknown`,
        { method: "DELETE" },
      );
      assert.equal(unauthenticatedDelete.status, 401);

      const createResponse = await api(owner, "/api/creations", {
        method: "POST",
        body: {
          instructions: "Make the background blue.",
          status: "draft",
          metadata: { width: 1200 },
        },
      });
      assert.equal(createResponse.status, 201);
      const { creation: first } = await createResponse.json();
      assert.equal(first.userId, owner.localId);
      assert.equal(first.status, "draft");
      assert.equal(first.isDeleted, false);
      assert.equal(first.revisionCount, 0);
      assert.ok(first.createdAt);
      assert.ok(first.updatedAt);
      assert.deepEqual(first.media, {});

      const sourceImage = await sharp({
        create: {
          width: 4,
          height: 3,
          channels: 3,
          background: "#ad5a4d",
        },
      })
        .png()
        .toBuffer();

      const invalidUploadResponse = await api(
        owner,
        `/api/creations/${first.id}/media/sourceImage/uploads`,
        {
          method: "POST",
          body: { contentType: "image/png", sizeBytes: 8 },
        },
      );
      const { upload: invalidUpload } = await invalidUploadResponse.json();
      const invalidStagedUpload = await fetch(invalidUpload.uploadUrl, {
        method: invalidUpload.method,
        headers: invalidUpload.headers,
        body: Buffer.from("testfile"),
      });
      assert.ok(invalidStagedUpload.ok, await invalidStagedUpload.text());

      const invalidCompleteResponse = await api(
        owner,
        `/api/creations/${first.id}/media/uploads/${invalidUpload.uploadId}/complete`,
        { method: "POST" },
      );
      assert.equal(invalidCompleteResponse.status, 400);
      assert.equal(
        (await invalidCompleteResponse.json()).error.code,
        "VALIDATION_ERROR",
      );
      assert.equal(
        (
          await firestore
            .collection("users")
            .doc(owner.localId)
            .collection("mediaUploadSessions")
            .doc(invalidUpload.uploadId)
            .get()
        ).exists,
        false,
      );

      const uploadResponse = await api(
        owner,
        `/api/creations/${first.id}/media/sourceImage/uploads`,
        {
          method: "POST",
          body: {
            contentType: "image/png",
            sizeBytes: sourceImage.length,
          },
        },
      );
      assert.equal(uploadResponse.status, 201);
      const { upload } = await uploadResponse.json();
      assert.equal(upload.method, "POST");
      const stagedUpload = await fetch(upload.uploadUrl, {
        method: upload.method,
        headers: upload.headers,
        body: sourceImage,
      });
      assert.ok(stagedUpload.ok, await stagedUpload.text());

      const completeResponse = await api(
        owner,
        `/api/creations/${first.id}/media/uploads/${upload.uploadId}/complete`,
        { method: "POST" },
      );
      assert.equal(completeResponse.status, 200);
      const { media } = await completeResponse.json();
      assert.equal(media.contentType, "image/png");
      assert.equal(media.width, 4);
      assert.equal(media.height, 3);
      assert.ok(media.sizeBytes > 0);
      assert.match(
        media.objectPath,
        new RegExp(
          `^users/${owner.localId}/creations/${first.id}/sourceImage/`,
        ),
      );
      const [storedImage] = await bucket.file(media.objectPath).download();
      const storedImageMetadata = await sharp(storedImage).metadata();
      assert.equal(storedImageMetadata.width, 4);
      assert.equal(storedImageMetadata.height, 3);
      assert.equal(storedImageMetadata.exif, undefined);
      const mediaReadResponse = await api(owner, `/api/creations/${first.id}`);
      const { creation: withMedia } = await mediaReadResponse.json();
      assert.deepEqual(withMedia.media.sourceImage, media);

      const downloadResponse = await api(
        owner,
        `/api/creations/${first.id}/media/sourceImage/download-url`,
      );
      assert.equal(downloadResponse.status, 200);
      assert.ok((await downloadResponse.json()).downloadUrl);
      const unauthorizedMediaRead = await api(
        otherUser,
        `/api/creations/${first.id}/media/sourceImage/download-url`,
      );
      assert.equal(unauthorizedMediaRead.status, 404);

      const pendingResponse = await api(
        owner,
        `/api/creations/${first.id}/media/audio/uploads`,
        {
          method: "POST",
          body: { contentType: "audio/webm", sizeBytes: 8 },
        },
      );
      assert.equal(pendingResponse.status, 201);
      const { upload: pendingUpload } = await pendingResponse.json();
      const stagedAudio = await fetch(pendingUpload.uploadUrl, {
        method: pendingUpload.method,
        headers: pendingUpload.headers,
        body: Buffer.from("audio123"),
      });
      assert.ok(stagedAudio.ok, await stagedAudio.text());

      const readResponse = await api(owner, `/api/creations/${first.id}`);
      assert.equal(readResponse.status, 200);
      assert.equal((await readResponse.json()).creation.id, first.id);

      const protectedField = await api(owner, `/api/creations/${first.id}`, {
        method: "PATCH",
        body: { userId: otherUser.localId },
      });
      assert.equal(protectedField.status, 400);

      const patchResponse = await api(owner, `/api/creations/${first.id}`, {
        method: "PATCH",
        body: {
          instructions: "Make the background green.",
          pinterest: { connected: false },
        },
      });
      assert.equal(patchResponse.status, 200);
      const { creation: updated } = await patchResponse.json();
      assert.equal(updated.instructions, "Make the background green.");
      assert.deepEqual(updated.pinterest, { connected: false });

      const secondResponse = await api(owner, "/api/creations", {
        method: "POST",
        body: {
          sourceImageUrl: "https://storage.example/second.png",
          status: "completed",
        },
      });
      assert.equal(secondResponse.status, 201);
      const { creation: second } = await secondResponse.json();

      const firstPageResponse = await api(owner, "/api/creations?limit=1");
      assert.equal(firstPageResponse.status, 200);
      const firstPage = await firstPageResponse.json();
      assert.equal(firstPage.creations.length, 1);
      assert.ok(firstPage.nextCursor);

      const nextPageResponse = await api(
        owner,
        `/api/creations?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      );
      assert.equal(nextPageResponse.status, 200);
      const nextPage = await nextPageResponse.json();
      assert.equal(nextPage.creations.length, 1);
      assert.equal(nextPage.nextCursor, null);
      assert.notEqual(firstPage.creations[0].id, nextPage.creations[0].id);

      const completedResponse = await api(
        owner,
        "/api/creations?status=completed",
      );
      assert.equal(completedResponse.status, 200);
      const completed = await completedResponse.json();
      assert.deepEqual(
        completed.creations.map((item) => item.id),
        [second.id],
      );

      const invalidQuery = await api(owner, "/api/creations?limit=101");
      assert.equal(invalidQuery.status, 400);
      const invalidStatus = await api(owner, "/api/creations?status=unknown");
      assert.equal(invalidStatus.status, 400);
      const invalidCursor = await api(
        owner,
        "/api/creations?cursor=missing-document",
      );
      assert.equal(invalidCursor.status, 400);

      const crossUserRead = await api(otherUser, `/api/creations/${first.id}`);
      assert.equal(crossUserRead.status, 404);
      const crossUserPatch = await api(
        otherUser,
        `/api/creations/${first.id}`,
        { method: "PATCH", body: { status: "failed" } },
      );
      assert.equal(crossUserPatch.status, 404);
      const crossUserDelete = await api(
        otherUser,
        `/api/creations/${first.id}`,
        { method: "DELETE" },
      );
      assert.equal(crossUserDelete.status, 404);
      const otherUsersList = await api(otherUser, "/api/creations");
      const otherUsersPage = await otherUsersList.json();
      assert.deepEqual(otherUsersPage.creations, []);
      assert.equal(otherUsersPage.nextCursor, null);
      const otherUsersCursor = await api(
        otherUser,
        `/api/creations?cursor=${encodeURIComponent(first.id)}`,
      );
      assert.equal(otherUsersCursor.status, 400);

      const deleteResponse = await api(owner, `/api/creations/${first.id}`, {
        method: "DELETE",
      });
      assert.equal(deleteResponse.status, 200);
      const deletedRead = await api(owner, `/api/creations/${first.id}`);
      assert.equal(deletedRead.status, 404);
      const remaining = await api(owner, "/api/creations");
      const remainingItems = (await remaining.json()).creations;
      assert.equal(
        remainingItems.some((item) => item.id === first.id),
        false,
      );

      const deletedSnapshot = await firestore
        .collection("users")
        .doc(owner.localId)
        .collection("creations")
        .doc(first.id)
        .get();
      assert.equal(deletedSnapshot.data().isDeleted, true);
      const [remainingMediaFiles] = await bucket.getFiles({
        prefix: `users/${owner.localId}/creations/${first.id}/`,
      });
      assert.deepEqual(remainingMediaFiles, []);
      const [remainingStagingFiles] = await bucket.getFiles({
        prefix: `staging/${owner.localId}/${first.id}/`,
      });
      assert.deepEqual(remainingStagingFiles, []);
      const remainingSessions = await firestore
        .collection("users")
        .doc(owner.localId)
        .collection("mediaUploadSessions")
        .where("creationId", "==", first.id)
        .get();
      assert.equal(remainingSessions.empty, true);
    } finally {
      for (const uid of users) {
        const sessions = await firestore
          .collection("users")
          .doc(uid)
          .collection("mediaUploadSessions")
          .get();
        const creations = await firestore
          .collection("users")
          .doc(uid)
          .collection("creations")
          .get();
        await Promise.all(
          creations.docs.map((document) => document.ref.delete()),
        );
        await Promise.all(
          sessions.docs.map((document) => document.ref.delete()),
        );
        for (const prefix of [`users/${uid}/creations/`, `staging/${uid}/`]) {
          const [files] = await bucket.getFiles({ prefix });
          await Promise.all(
            files.map((file) => file.delete({ ignoreNotFound: true })),
          );
        }
        await firestore.collection("users").doc(uid).delete();
        await auth.deleteUser(uid);
      }
      server.close();
      await once(server, "close");
    }
  },
);

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import {
  completeGooglePhotosAuthorization,
  createGooglePhotosAuthorization,
  createGooglePhotosPickerSession,
  disconnectGooglePhotos,
  getGooglePhotosConnectionStatus,
  importGooglePhotosPickerItem,
  listGooglePhotosPickerItems,
  pollGooglePhotosPickerSession,
  saveGooglePhotosImage,
} from "../src/services/googlePhotosService.js";

const userId = "test-user";
const creationId = "test-creation";
const origin = "http://localhost:5174";
const config = {
  googlePhotosClientId: "test-client-id",
  googlePhotosClientSecret: "test-client-secret",
  googlePhotosRedirectUri:
    "http://localhost:4000/api/google-photos/oauth/callback",
  googlePhotosTokenEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
};
const scope =
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly https://www.googleapis.com/auth/photoslibrary.appendonly";

class FakeFirestore {
  documents = new Map();

  collection(collectionName) {
    return this.collectionReference(collectionName);
  }

  collectionReference(path) {
    return {
      doc: (id) => this.documentReference(`${path}/${id}`),
    };
  }

  documentReference(path) {
    return {
      get: async () => ({
        exists: this.documents.has(path),
        data: () => this.documents.get(path),
      }),
      set: async (value) => {
        this.documents.set(path, value);
      },
      update: async (value) => {
        const document = { ...this.documents.get(path) };
        for (const [field, fieldValue] of Object.entries(value)) {
          const segments = field.split(".");
          let target = document;
          while (segments.length > 1) {
            const segment = segments.shift();
            target[segment] ||= {};
            target = target[segment];
          }
          target[segments[0]] = fieldValue;
        }
        this.documents.set(path, document);
      },
      delete: async () => {
        this.documents.delete(path);
      },
      collection: (collectionName) =>
        this.collectionReference(`${path}/${collectionName}`),
    };
  }

  async runTransaction(callback) {
    return callback({
      get: (reference) => reference.get(),
      delete: (reference) => reference.delete(),
    });
  }
}

function tokenPath() {
  return `users/${userId}/integrations/googlePhotos`;
}

function pickerPath(sessionId) {
  return `users/${userId}/googlePhotosSessions/${sessionId}`;
}

function makeStorage() {
  const objects = new Map();
  const bucket = {
    name: "test-media-bucket",
    file(path) {
      return {
        getSignedUrl: async () => [
          `https://storage.example/${encodeURIComponent(path)}`,
        ],
        exists: async () => [objects.has(path)],
        getMetadata: async () => {
          const object = objects.get(path);
          return [
            {
              size: String(object.bytes.length),
              contentType: object.contentType,
            },
          ];
        },
        download: async () => [objects.get(path).bytes],
        save: async (bytes, options) => {
          objects.set(path, {
            bytes: Buffer.from(bytes),
            contentType: options.metadata.contentType,
          });
        },
        setMetadata: async (metadata) => {
          const object = objects.get(path);
          object.contentType = metadata.contentType;
        },
        delete: async () => {
          objects.delete(path);
        },
        copy: async (destination) => {
          objects.set(destination.name, objects.get(path));
        },
      };
    },
  };
  const uploads = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "storage.example") {
      const path = decodeURIComponent(url.pathname.slice(1));
      objects.set(path, {
        bytes: Buffer.from(options.body),
        contentType: options.headers["Content-Type"],
      });
      uploads.push(path);
      return new Response(null, { status: 200 });
    }
    return null;
  };
  return { bucket, objects, uploads, fetchImpl };
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

async function connectGooglePhotos(firestore, fetchImpl) {
  const { authorizationUrl } = await createGooglePhotosAuthorization(
    firestore,
    userId,
    origin,
    config,
    [origin],
  );
  const auth = new URL(authorizationUrl);
  const state = auth.searchParams.get("state");
  const callback = await completeGooglePhotosAuthorization(
    firestore,
    { code: "authorization-code", state },
    config,
    fetchImpl,
  );
  assert.equal(callback.status, "connected");
  return auth;
}

test("Google Photos OAuth requests Picker and save scopes with PKCE and encrypted token storage", async () => {
  const firestore = new FakeFirestore();
  const authorization = await createGooglePhotosAuthorization(
    firestore,
    userId,
    origin,
    config,
    [origin],
  );
  const authUrl = new URL(authorization.authorizationUrl);
  const state = authUrl.searchParams.get("state");
  const stateDoc = firestore.documents.get(`googlePhotosOAuthStates/${state}`);

  assert.equal(authUrl.searchParams.get("scope"), scope);
  assert.equal(authUrl.searchParams.get("access_type"), "offline");
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  assert.match(authUrl.searchParams.get("code_challenge"), /^[\w-]{43}$/);
  assert.equal(stateDoc.userId, userId);
  assert.equal(stateDoc.origin, origin);

  const callback = await completeGooglePhotosAuthorization(
    firestore,
    { code: "authorization-code", state },
    config,
    async (url, options) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("code_verifier"), stateDoc.verifier);
      return Response.json({
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        expires_in: 3600,
        scope,
      });
    },
  );
  const tokenDocument = firestore.documents.get(tokenPath());
  assert.deepEqual(callback, { origin, status: "connected" });
  assert.equal(
    firestore.documents.has(`googlePhotosOAuthStates/${state}`),
    false,
  );
  assert.equal(tokenDocument.encryptedTokens.version, 1);
  assert.equal(JSON.stringify(tokenDocument).includes("refresh-secret"), false);
  assert.deepEqual(
    await getGooglePhotosConnectionStatus(firestore, userId, config),
    { connected: true, canSave: true },
  );
  await assert.rejects(
    completeGooglePhotosAuthorization(
      firestore,
      { code: "replay", state },
      config,
      async () => {
        throw new Error("OAuth state replayed the token exchange.");
      },
    ),
    /OAuth state is invalid or expired/,
  );
});

test("Google Photos saves an owned image through the Library upload API", async () => {
  const firestore = new FakeFirestore();
  const { bucket, objects } = makeStorage();
  await connectGooglePhotos(firestore, async () =>
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope,
    }),
  );

  const imageBytes = await createPng();
  const objectPath = `users/${userId}/creations/${creationId}/outputImage/generated`;
  objects.set(objectPath, {
    bytes: imageBytes,
    contentType: "image/png",
  });
  let batchCreated = false;
  const result = await saveGooglePhotosImage(
    firestore,
    bucket,
    userId,
    creationId,
    "outputImage",
    {
      media: {
        outputImage: { objectPath, contentType: "image/png" },
      },
    },
    config,
    async (input, options) => {
      const url = new URL(String(input));
      assert.equal(options.headers.Authorization, "Bearer access-secret");
      if (url.pathname === "/v1/uploads") {
        assert.equal(options.method, "POST");
        assert.equal(
          options.headers["X-Goog-Upload-Content-Type"],
          "image/png",
        );
        assert.equal(options.headers["X-Goog-Upload-Protocol"], "raw");
        assert.deepEqual(Buffer.from(options.body), imageBytes);
        return new Response("upload-token", { status: 200 });
      }
      assert.equal(url.pathname, "/v1/mediaItems:batchCreate");
      const body = JSON.parse(options.body);
      assert.equal(
        body.newMediaItems[0].simpleMediaItem.fileName,
        "pinboard-studio-outputImage.png",
      );
      assert.equal(
        body.newMediaItems[0].simpleMediaItem.uploadToken,
        "upload-token",
      );
      batchCreated = true;
      return Response.json({
        newMediaItemResults: [
          { status: { code: 0 }, mediaItem: { id: "google-photo-id" } },
        ],
      });
    },
  );

  assert.equal(batchCreated, true);
  assert.deepEqual(result, { saved: true });
});

test("Google Photos refreshes and retries the upload after a rejected access token", async () => {
  const firestore = new FakeFirestore();
  const { bucket, objects } = makeStorage();
  await connectGooglePhotos(firestore, async () =>
    Response.json({
      access_token: "expired-access-token",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope,
    }),
  );

  const imageBytes = await createPng();
  const objectPath = `users/${userId}/creations/${creationId}/sourceImage/uploaded`;
  objects.set(objectPath, {
    bytes: imageBytes,
    contentType: "image/png",
  });
  let uploadAttempts = 0;
  let tokenRefreshes = 0;
  const result = await saveGooglePhotosImage(
    firestore,
    bucket,
    userId,
    creationId,
    "sourceImage",
    {
      media: {
        sourceImage: { objectPath, contentType: "image/png" },
      },
    },
    config,
    async (input, options) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        tokenRefreshes += 1;
        return Response.json({
          access_token: "refreshed-access-token",
          expires_in: 3600,
        });
      }
      if (url.pathname === "/v1/uploads") {
        uploadAttempts += 1;
        if (options.headers.Authorization === "Bearer expired-access-token") {
          return Response.json(
            { error: { status: "UNAUTHENTICATED" } },
            { status: 401 },
          );
        }
        assert.equal(
          options.headers.Authorization,
          "Bearer refreshed-access-token",
        );
        return new Response("upload-token", { status: 200 });
      }
      assert.equal(url.pathname, "/v1/mediaItems:batchCreate");
      assert.equal(
        options.headers.Authorization,
        "Bearer refreshed-access-token",
      );
      return Response.json({
        newMediaItemResults: [
          { status: { code: 0 }, mediaItem: { id: "google-photo-id" } },
        ],
      });
    },
  );

  assert.equal(uploadAttempts, 2);
  assert.equal(tokenRefreshes, 1);
  assert.deepEqual(result, { saved: true });
});

test("Google Photos refreshes and retries media creation after a rejected access token", async () => {
  const firestore = new FakeFirestore();
  const { bucket, objects } = makeStorage();
  await connectGooglePhotos(firestore, async () =>
    Response.json({
      access_token: "expired-access-token",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope,
    }),
  );

  const imageBytes = await createPng();
  const objectPath = `users/${userId}/creations/${creationId}/sourceImage/uploaded`;
  objects.set(objectPath, {
    bytes: imageBytes,
    contentType: "image/png",
  });
  let batchAttempts = 0;
  const result = await saveGooglePhotosImage(
    firestore,
    bucket,
    userId,
    creationId,
    "sourceImage",
    {
      media: {
        sourceImage: { objectPath, contentType: "image/png" },
      },
    },
    config,
    async (input, options) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({
          access_token: "refreshed-access-token",
          expires_in: 3600,
        });
      }
      if (url.pathname === "/v1/uploads") {
        return new Response("upload-token", { status: 200 });
      }
      assert.equal(url.pathname, "/v1/mediaItems:batchCreate");
      batchAttempts += 1;
      if (batchAttempts === 1) {
        return Response.json(
          { error: { status: "UNAUTHENTICATED" } },
          { status: 401 },
        );
      }
      assert.equal(
        options.headers.Authorization,
        "Bearer refreshed-access-token",
      );
      return Response.json({
        newMediaItemResults: [
          { status: { code: 0 }, mediaItem: { id: "google-photo-id" } },
        ],
      });
    },
  );

  assert.equal(batchAttempts, 2);
  assert.deepEqual(result, { saved: true });
});

test("Google Photos upload reports when the Library API is disabled", async () => {
  const firestore = new FakeFirestore();
  const { bucket, objects } = makeStorage();
  await connectGooglePhotos(firestore, async () =>
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope,
    }),
  );

  const imageBytes = await createPng();
  const objectPath = `users/${userId}/creations/${creationId}/sourceImage/uploaded`;
  objects.set(objectPath, {
    bytes: imageBytes,
    contentType: "image/png",
  });

  await assert.rejects(
    saveGooglePhotosImage(
      firestore,
      bucket,
      userId,
      creationId,
      "sourceImage",
      {
        media: {
          sourceImage: { objectPath, contentType: "image/png" },
        },
      },
      config,
      async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "oauth2.googleapis.com") {
          return Response.json({
            access_token: "access-secret",
            expires_in: 3600,
          });
        }
        return Response.json(
          {
            error: {
              code: 403,
              status: "PERMISSION_DENIED",
              details: [{ reason: "SERVICE_DISABLED" }],
            },
          },
          { status: 403 },
        );
      },
    ),
    (error) => {
      assert.equal(error.code, "GOOGLE_PHOTOS_API_DISABLED");
      assert.match(error.message, /Enable the Google Photos Library API/);
      return true;
    },
  );
});

test("Google Photos OAuth rejects an unapproved browser origin", async () => {
  await assert.rejects(
    createGooglePhotosAuthorization(
      new FakeFirestore(),
      userId,
      "https://attacker.example",
      config,
      [origin],
    ),
    /origin is not allowed/,
  );
});

test("Google Photos connection status includes save permission", async () => {
  const firestore = new FakeFirestore();
  assert.deepEqual(
    await getGooglePhotosConnectionStatus(firestore, userId, config),
    { connected: false, canSave: false },
  );
});

test("Google Photos does not mark a Picker-only grant as save-enabled", async () => {
  const firestore = new FakeFirestore();
  const authorization = await createGooglePhotosAuthorization(
    firestore,
    userId,
    origin,
    config,
    [origin],
  );
  const state = new URL(authorization.authorizationUrl).searchParams.get(
    "state",
  );
  const result = await completeGooglePhotosAuthorization(
    firestore,
    { code: "authorization-code", state },
    config,
    async () =>
      Response.json({
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        expires_in: 3600,
        scope:
          "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
      }),
  );

  assert.deepEqual(result, { origin, status: "error" });
  assert.equal(firestore.documents.has(tokenPath()), false);
});

test("Google Photos disconnect revokes the refresh token before removing encrypted tokens", async () => {
  const firestore = new FakeFirestore();
  await connectGooglePhotos(firestore, async () =>
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope,
    }),
  );
  let revoked = false;
  const result = await disconnectGooglePhotos(
    firestore,
    userId,
    config,
    async (url, options) => {
      assert.equal(url, "https://oauth2.googleapis.com/revoke");
      assert.equal(
        new URLSearchParams(options.body).get("token"),
        "refresh-secret",
      );
      revoked = true;
      return new Response(null, { status: 200 });
    },
  );

  assert.deepEqual(result, { disconnected: true });
  assert.equal(revoked, true);
  assert.equal(firestore.documents.has(tokenPath()), false);
});

test("Picker sessions are owner-bound, pollable, and expose only selected photo metadata", async () => {
  const firestore = new FakeFirestore();
  await connectGooglePhotos(firestore, async () =>
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope,
    }),
  );

  const selected = {
    id: "selected-photo",
    type: "PHOTO",
    mediaFile: {
      baseUrl: "https://lh3.googleusercontent.com/photo",
      filename: "garden.png",
      mimeType: "image/png",
      mediaFileMetadata: { width: 4, height: 3 },
    },
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    if (
      url.hostname === "photospicker.googleapis.com" &&
      options.method === "POST"
    ) {
      return Response.json({
        id: "google-session-id",
        pickerUri: "https://photos.google.com/picker/session",
        expireTime: new Date(Date.now() + 60_000).toISOString(),
        pollingConfig: { pollInterval: "3s", timeoutIn: "300s" },
      });
    }
    if (url.pathname.endsWith("/sessions/google-session-id")) {
      return Response.json({ mediaItemsSet: true });
    }
    if (url.pathname.endsWith("/mediaItems")) {
      assert.equal(url.searchParams.get("sessionId"), "google-session-id");
      return Response.json({
        mediaItems: [
          selected,
          {
            id: "selected-video",
            type: "VIDEO",
            mediaFile: {
              filename: "movie.mp4",
              mimeType: "video/mp4",
              baseUrl: "https://lh3.googleusercontent.com/video",
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  };

  const session = await createGooglePhotosPickerSession(
    firestore,
    userId,
    creationId,
    config,
    fetchImpl,
  );
  assert.equal(
    session.pickerUri,
    "https://photos.google.com/picker/session/autoclose",
  );
  assert.equal(
    firestore.documents.get(pickerPath(session.sessionId)).creationId,
    creationId,
  );
  assert.equal(
    (
      await pollGooglePhotosPickerSession(
        firestore,
        userId,
        session.sessionId,
        config,
        fetchImpl,
      )
    ).mediaItemsSet,
    true,
  );
  const items = await listGooglePhotosPickerItems(
    firestore,
    userId,
    session.sessionId,
    config,
    fetchImpl,
  );
  assert.deepEqual(items.mediaItems, [
    {
      id: "selected-photo",
      filename: "garden.png",
      mimeType: "image/png",
      width: 4,
      height: 3,
    },
  ]);
  assert.equal(JSON.stringify(items).includes("baseUrl"), false);
  await assert.rejects(
    pollGooglePhotosPickerSession(
      firestore,
      "another-user",
      session.sessionId,
      config,
      fetchImpl,
    ),
    /session not found/,
  );
});

test("Picker import stages selected media directly and sends bytes through the validated storage finalizer", async () => {
  const firestore = new FakeFirestore();
  const imageBytes = await createPng();
  const uploadHarness = makeStorage();
  const creationRef = firestore
    .collection("users")
    .doc(userId)
    .collection("creations")
    .doc(creationId);
  await creationRef.set({ media: {} });

  await connectGooglePhotos(firestore, async () =>
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope,
    }),
  );
  const sessionId = randomUUID();
  firestore.documents.set(pickerPath(sessionId), {
    creationId,
    googleSessionId: "google-session-id",
    expiresAt: {
      toDate: () => new Date(Date.now() + 60_000),
    },
  });

  const selected = {
    id: "selected-photo",
    type: "PHOTO",
    mediaFile: {
      baseUrl: "https://lh3.googleusercontent.com/photo",
      filename: "garden.png",
      mimeType: "image/png",
    },
  };
  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ url: url.toString(), method: options.method || "GET" });
    if (url.hostname === "photospicker.googleapis.com") {
      if (options.method === "DELETE")
        return new Response(null, { status: 204 });
      if (url.pathname.endsWith("/sessions/google-session-id")) {
        return Response.json({ mediaItemsSet: true });
      }
      if (url.pathname.endsWith("/mediaItems")) {
        return Response.json({ mediaItems: [selected] });
      }
    }
    if (url.hostname === "lh3.googleusercontent.com") {
      assert.equal(url.pathname, "/photo=d");
      assert.equal(options.headers.Authorization, "Bearer access-secret");
      return new Response(imageBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  };

  const media = await importGooglePhotosPickerItem(
    firestore,
    uploadHarness.bucket,
    userId,
    creationId,
    sessionId,
    selected.id,
    config,
    fetchImpl,
  );

  assert.equal(media.contentType, "image/png");
  assert.equal(media.width, 4);
  assert.equal(media.height, 3);
  assert.equal(media.importedFrom, "google_photos_picker");
  assert.match(
    media.objectPath,
    new RegExp(`^users/${userId}/creations/${creationId}/sourceImage/`),
  );
  assert.equal(
    requests.some(({ url }) => url.includes("storage.example")),
    false,
  );
  assert.equal(
    requests.some(
      ({ url, method }) =>
        url.includes("googleusercontent.com") && method === "GET",
    ),
    true,
  );
  assert.equal(firestore.documents.has(pickerPath(sessionId)), false);
  const creation = await creationRef.get();
  assert.deepEqual(creation.data().media.sourceImage, media);
  assert.equal(uploadHarness.objects.size, 1);
});

test("Picker import rejects corrupt image bytes and removes staged data", async () => {
  const firestore = new FakeFirestore();
  const uploadHarness = makeStorage();
  await firestore
    .collection("users")
    .doc(userId)
    .collection("creations")
    .doc(creationId)
    .set({ media: {} });
  await connectGooglePhotos(firestore, async () =>
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope,
    }),
  );
  const sessionId = randomUUID();
  firestore.documents.set(pickerPath(sessionId), {
    creationId,
    googleSessionId: "google-session-id",
    expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
  });
  const selected = {
    id: "selected-corrupt-photo",
    type: "PHOTO",
    mediaFile: {
      baseUrl: "https://lh3.googleusercontent.com/corrupt",
      filename: "image.png",
      mimeType: "image/png",
    },
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    if (
      url.hostname === "photospicker.googleapis.com" &&
      options.method === "DELETE"
    ) {
      return new Response(null, { status: 204 });
    }
    if (
      url.hostname === "photospicker.googleapis.com" &&
      url.pathname.endsWith("/sessions/google-session-id")
    ) {
      return Response.json({ mediaItemsSet: true });
    }
    if (
      url.hostname === "photospicker.googleapis.com" &&
      url.pathname.endsWith("/mediaItems")
    ) {
      return Response.json({ mediaItems: [selected] });
    }
    if (url.hostname === "lh3.googleusercontent.com") {
      return new Response("corrupt image", { status: 200 });
    }
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  };

  await assert.rejects(
    importGooglePhotosPickerItem(
      firestore,
      uploadHarness.bucket,
      userId,
      creationId,
      sessionId,
      selected.id,
      config,
      fetchImpl,
    ),
    /invalid or no longer available/,
  );
  assert.equal(uploadHarness.objects.size, 0);
  assert.equal(firestore.documents.has(pickerPath(sessionId)), false);
});

test("Picker import rejects untrusted Google media hosts and cleans its session", async () => {
  const firestore = new FakeFirestore();
  await connectGooglePhotos(firestore, async () =>
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope,
    }),
  );
  const sessionId = randomUUID();
  firestore.documents.set(pickerPath(sessionId), {
    creationId,
    googleSessionId: "google-session-id",
    expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
  });
  const selected = {
    id: "selected-photo",
    type: "PHOTO",
    mediaFile: {
      baseUrl: "https://attacker.example/steal",
      filename: "image.png",
      mimeType: "image/png",
    },
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    if (
      url.hostname === "photospicker.googleapis.com" &&
      options.method === "DELETE"
    ) {
      return new Response(null, { status: 204 });
    }
    if (
      url.hostname === "photospicker.googleapis.com" &&
      url.pathname.endsWith("/sessions/google-session-id")
    ) {
      return Response.json({ mediaItemsSet: true });
    }
    if (
      url.hostname === "photospicker.googleapis.com" &&
      url.pathname.endsWith("/mediaItems")
    ) {
      return Response.json({ mediaItems: [selected] });
    }
    throw new Error(`Unexpected or unsafe request: ${url}`);
  };
  await assert.rejects(
    importGooglePhotosPickerItem(
      firestore,
      makeStorage().bucket,
      userId,
      creationId,
      sessionId,
      selected.id,
      config,
      fetchImpl,
    ),
    /invalid media URL/,
  );
  assert.equal(firestore.documents.has(pickerPath(sessionId)), false);
});

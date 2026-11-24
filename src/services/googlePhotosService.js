import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { ApiError } from "../middleware/errorHandler.js";
import { MAX_IMAGE_BYTES } from "../models/mediaValidation.js";
import {
  completeMediaUpload,
  createMediaUpload,
  discardMediaUpload,
  stageMediaUploadBuffer,
} from "./mediaStorageService.js";

export const GOOGLE_PHOTOS_PICKER_SCOPE =
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
export const GOOGLE_PHOTOS_APPEND_SCOPE =
  "https://www.googleapis.com/auth/photoslibrary.appendonly";
export const GOOGLE_PHOTOS_SCOPE = [
  GOOGLE_PHOTOS_PICKER_SCOPE,
  GOOGLE_PHOTOS_APPEND_SCOPE,
].join(" ");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_PICKER_API = "https://photospicker.googleapis.com/v1";
const GOOGLE_LIBRARY_API = "https://photoslibrary.googleapis.com/v1";
const GOOGLE_MEDIA_HOST = "googleusercontent.com";
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_SELECTED_ITEMS = 10;
const GOOGLE_REQUEST_TIMEOUT_MS = 15_000;

function getEncryptionKey(config) {
  const encoded = config.googlePhotosTokenEncryptionKey;
  if (!encoded) {
    throw new ApiError(
      503,
      "GOOGLE_PHOTOS_NOT_CONFIGURED",
      "Google Photos is not configured for this service.",
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new ApiError(
      503,
      "GOOGLE_PHOTOS_NOT_CONFIGURED",
      "Google Photos token encryption is not configured correctly.",
    );
  }
  return key;
}

function assertOAuthConfig(config) {
  getEncryptionKey(config);
  if (
    !config.googlePhotosClientId ||
    !config.googlePhotosClientSecret ||
    !config.googlePhotosRedirectUri
  ) {
    throw new ApiError(
      503,
      "GOOGLE_PHOTOS_NOT_CONFIGURED",
      "Google Photos is not configured for this service.",
    );
  }
  let redirect;
  try {
    redirect = new URL(config.googlePhotosRedirectUri);
  } catch {
    throw new ApiError(
      503,
      "GOOGLE_PHOTOS_NOT_CONFIGURED",
      "Google Photos redirect configuration is invalid.",
    );
  }
  if (
    redirect.protocol !== "https:" &&
    !(redirect.protocol === "http:" && redirect.hostname === "localhost")
  ) {
    throw new ApiError(
      503,
      "GOOGLE_PHOTOS_NOT_CONFIGURED",
      "Google Photos redirect configuration must use HTTPS.",
    );
  }
}

function encryptTokens(tokens, config, userId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(config), iv);
  cipher.setAAD(Buffer.from(`pinboard-google-photos-v1:${userId}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

function decryptTokens(encrypted, config, userId) {
  if (encrypted?.version !== 1) {
    throw new Error("Stored Google Photos token version is unsupported.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(config),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(`pinboard-google-photos-v1:${userId}`));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext);
}

function tokenReference(firestore, userId) {
  return firestore
    .collection("users")
    .doc(userId)
    .collection("integrations")
    .doc("googlePhotos");
}

function pickerSessionCollection(firestore, userId) {
  return firestore
    .collection("users")
    .doc(userId)
    .collection("googlePhotosSessions");
}

async function postForm(url, body, failureMessage, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, "GOOGLE_PHOTOS_UNAVAILABLE", failureMessage);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new ApiError(502, "GOOGLE_PHOTOS_UNAVAILABLE", failureMessage);
  }
  return payload;
}

async function googleApiRequest(
  url,
  accessToken,
  options = {},
  fetchImpl = fetch,
) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_UNAVAILABLE",
      "Google Photos could not be reached. Please retry.",
    );
  }

  if (response.status === 404 && options.method === "DELETE") return null;
  if (response.status === 401) {
    throw new ApiError(
      401,
      "GOOGLE_PHOTOS_REAUTH_REQUIRED",
      "Reconnect your Google Photos account and try again.",
    );
  }
  if (!response.ok) {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_REQUEST_FAILED",
      "Google Photos could not complete this request. Please retry.",
    );
  }
  if (options.method === "DELETE" || response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_INVALID_RESPONSE",
      "Google Photos returned an invalid response. Please retry.",
    );
  }
}

function hasScope(scopes, requiredScope) {
  const grantedScopes = Array.isArray(scopes)
    ? scopes
    : typeof scopes === "string"
      ? scopes.split(/\s+/)
      : [];
  return grantedScopes.includes(requiredScope);
}

export async function getGooglePhotosConnectionStatus(
  firestore,
  userId,
  config,
) {
  assertOAuthConfig(config);
  const snapshot = await tokenReference(firestore, userId).get();
  if (!snapshot.exists) return { connected: false, canSave: false };
  const tokens = decryptTokens(snapshot.data().encryptedTokens, config, userId);
  return {
    connected: hasScope(tokens.scope, GOOGLE_PHOTOS_PICKER_SCOPE),
    canSave: hasScope(tokens.scope, GOOGLE_PHOTOS_APPEND_SCOPE),
  };
}

export async function createGooglePhotosAuthorization(
  firestore,
  userId,
  origin,
  config,
  allowedOrigins,
) {
  assertOAuthConfig(config);
  if (!allowedOrigins.includes(origin)) {
    throw new ApiError(
      403,
      "CORS_ORIGIN_DENIED",
      "This website origin is not allowed by the API.",
    );
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
  await firestore
    .collection("googlePhotosOAuthStates")
    .doc(state)
    .set({
      userId,
      origin,
      verifier,
      expiresAt: Timestamp.fromDate(expiresAt),
    });

  const authorizationUrl = new URL(GOOGLE_AUTH_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.googlePhotosClientId,
    redirect_uri: config.googlePhotosRedirectUri,
    response_type: "code",
    scope: GOOGLE_PHOTOS_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { authorizationUrl: authorizationUrl.toString() };
}

async function consumeOAuthState(firestore, state) {
  if (typeof state !== "string" || !/^[\w-]{40,60}$/.test(state)) {
    throw new ApiError(
      400,
      "INVALID_OAUTH_STATE",
      "OAuth state is invalid or expired.",
    );
  }
  const reference = firestore.collection("googlePhotosOAuthStates").doc(state);
  const consumed = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return null;
    const stored = snapshot.data();
    transaction.delete(reference);
    if (!stored.expiresAt || stored.expiresAt.toDate() <= new Date()) {
      return null;
    }
    return stored;
  });
  if (!consumed) {
    throw new ApiError(
      400,
      "INVALID_OAUTH_STATE",
      "OAuth state is invalid or expired.",
    );
  }
  return consumed;
}

export async function completeGooglePhotosAuthorization(
  firestore,
  { code, state, providerError },
  config,
  fetchImpl = fetch,
) {
  assertOAuthConfig(config);
  const storedState = await consumeOAuthState(firestore, state);
  if (providerError) return { origin: storedState.origin, status: "denied" };
  if (typeof code !== "string" || !code) {
    return { origin: storedState.origin, status: "error" };
  }

  let payload;
  try {
    payload = await postForm(
      GOOGLE_TOKEN_URL,
      {
        code,
        client_id: config.googlePhotosClientId,
        client_secret: config.googlePhotosClientSecret,
        redirect_uri: config.googlePhotosRedirectUri,
        grant_type: "authorization_code",
        code_verifier: storedState.verifier,
      },
      "Google Photos authorization could not be completed. Please try again.",
      fetchImpl,
    );
  } catch {
    return { origin: storedState.origin, status: "error" };
  }

  const grantedScopes =
    typeof payload.scope === "string"
      ? payload.scope.split(/\s+/).filter(Boolean)
      : [];
  if (
    typeof payload.access_token !== "string" ||
    typeof payload.refresh_token !== "string" ||
    !hasScope(grantedScopes, GOOGLE_PHOTOS_PICKER_SCOPE) ||
    !hasScope(grantedScopes, GOOGLE_PHOTOS_APPEND_SCOPE) ||
    !Number.isFinite(Number(payload.expires_in))
  ) {
    return { origin: storedState.origin, status: "error" };
  }

  const tokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + Number(payload.expires_in) * 1000,
    scope: grantedScopes,
  };
  await tokenReference(firestore, storedState.userId).set({
    encryptedTokens: encryptTokens(tokens, config, storedState.userId),
    updatedAt: Timestamp.now(),
  });
  return { origin: storedState.origin, status: "connected" };
}

async function getAccessToken(
  firestore,
  userId,
  config,
  fetchImpl,
  requiredScope = GOOGLE_PHOTOS_PICKER_SCOPE,
  { forceRefresh = false } = {},
) {
  assertOAuthConfig(config);
  const reference = tokenReference(firestore, userId);
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    throw new ApiError(
      409,
      "GOOGLE_PHOTOS_NOT_CONNECTED",
      "Connect your Google Photos account before importing a photo.",
    );
  }

  const tokens = decryptTokens(snapshot.data().encryptedTokens, config, userId);
  if (!hasScope(tokens.scope, requiredScope)) {
    throw new ApiError(
      403,
      "GOOGLE_PHOTOS_PERMISSION_REQUIRED",
      "Reconnect Google Photos and approve permission to save images.",
    );
  }
  if (
    !forceRefresh &&
    tokens.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS
  ) {
    return tokens.accessToken;
  }

  const refreshed = await postForm(
    GOOGLE_TOKEN_URL,
    {
      client_id: config.googlePhotosClientId,
      client_secret: config.googlePhotosClientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    },
    "Google Photos authorization expired. Reconnect your account and retry.",
    fetchImpl,
  );
  if (
    typeof refreshed.access_token !== "string" ||
    !Number.isFinite(Number(refreshed.expires_in))
  ) {
    throw new ApiError(
      401,
      "GOOGLE_PHOTOS_REAUTH_REQUIRED",
      "Reconnect your Google Photos account and try again.",
    );
  }
  tokens.accessToken = refreshed.access_token;
  tokens.expiresAt = Date.now() + Number(refreshed.expires_in) * 1000;
  if (typeof refreshed.refresh_token === "string") {
    tokens.refreshToken = refreshed.refresh_token;
  }
  await reference.set({
    encryptedTokens: encryptTokens(tokens, config, userId),
    updatedAt: Timestamp.now(),
  });
  return tokens.accessToken;
}

async function uploadGooglePhotosBytes(
  imageBytes,
  contentType,
  accessToken,
  fetchImpl,
) {
  try {
    return await fetchImpl(`${GOOGLE_LIBRARY_API}/uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
        "X-Goog-Upload-Content-Type": contentType,
        "X-Goog-Upload-Protocol": "raw",
      },
      body: imageBytes,
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_UNAVAILABLE",
      "Google Photos could not be reached. Please retry.",
    );
  }
}

async function googleApiRequestWithTokenRefresh(
  firestore,
  userId,
  config,
  url,
  accessToken,
  options,
  fetchImpl,
) {
  try {
    return await googleApiRequest(url, accessToken, options, fetchImpl);
  } catch (error) {
    if (error.status !== 401) throw error;
  }

  const refreshedAccessToken = await getAccessToken(
    firestore,
    userId,
    config,
    fetchImpl,
    GOOGLE_PHOTOS_APPEND_SCOPE,
    { forceRefresh: true },
  );
  return googleApiRequest(url, refreshedAccessToken, options, fetchImpl);
}

export async function disconnectGooglePhotos(
  firestore,
  userId,
  config,
  fetchImpl = fetch,
) {
  assertOAuthConfig(config);
  const reference = tokenReference(firestore, userId);
  const snapshot = await reference.get();
  if (!snapshot.exists) return { disconnected: true };

  const tokens = decryptTokens(snapshot.data().encryptedTokens, config, userId);
  let response;
  try {
    response = await fetchImpl(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken }),
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_REVOCATION_FAILED",
      "Google Photos access could not be revoked. Your connection is unchanged.",
    );
  }
  if (!response.ok) {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_REVOCATION_FAILED",
      "Google Photos access could not be revoked. Your connection is unchanged.",
    );
  }
  await reference.delete();
  return { disconnected: true };
}

function googleUploadErrorReason(payload) {
  const reasons = [
    ...(payload?.error?.details || []).map((detail) => detail?.reason),
    ...(payload?.error?.errors || []).map((detail) => detail?.reason),
    payload?.error?.status,
  ];
  return reasons.find(
    (reason) =>
      typeof reason === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(reason),
  );
}

function throwGoogleUploadError(response, responseBody) {
  let payload;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    payload = null;
  }

  const reason = googleUploadErrorReason(payload);
  console.warn(
    JSON.stringify({
      event: "google_photos_upload_rejected",
      status: response.status,
      reason: reason || "UNKNOWN",
    }),
  );

  if (reason === "SERVICE_DISABLED") {
    throw new ApiError(
      503,
      "GOOGLE_PHOTOS_API_DISABLED",
      "Google Photos uploads are not enabled for this app. Enable the Google Photos Library API in its Google Cloud project, then retry.",
    );
  }
  if (response.status === 401) {
    throw new ApiError(
      401,
      "GOOGLE_PHOTOS_REAUTH_REQUIRED",
      "Reconnect your Google Photos account and try again.",
    );
  }
  if (
    reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" ||
    reason === "PERMISSION_DENIED"
  ) {
    throw new ApiError(
      403,
      "GOOGLE_PHOTOS_PERMISSION_REQUIRED",
      "Google Photos denied permission to upload. Reconnect Google Photos and approve the save permission.",
    );
  }
  if (response.status === 429) {
    throw new ApiError(
      429,
      "GOOGLE_PHOTOS_RATE_LIMITED",
      "Google Photos is temporarily limiting uploads. Wait a little and retry.",
    );
  }
  throw new ApiError(
    502,
    "GOOGLE_PHOTOS_UPLOAD_FAILED",
    "Google Photos rejected the image upload. Please retry. If this keeps happening, check the Google Photos API and OAuth configuration.",
  );
}

export async function saveGooglePhotosImage(
  firestore,
  bucket,
  userId,
  creationId,
  mediaKind,
  creation,
  config,
  fetchImpl = fetch,
) {
  if (!["sourceImage", "outputImage"].includes(mediaKind)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Choose a source or generated image to save.",
    );
  }

  let accessToken = await getAccessToken(
    firestore,
    userId,
    config,
    fetchImpl,
    GOOGLE_PHOTOS_APPEND_SCOPE,
  );
  const media = creation.media?.[mediaKind];
  const expectedPrefix = `users/${userId}/creations/${creationId}/${mediaKind}/`;
  if (!media?.objectPath?.startsWith(expectedPrefix)) {
    throw new ApiError(404, "NOT_FOUND", "Image not found.");
  }

  const contentType = media.contentType;
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (!extensions[contentType]) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Image format is not supported.",
    );
  }

  const file = bucket.file(media.objectPath);
  const [metadata] = await file.getMetadata();
  const metadataSize = Number(metadata.size);
  if (
    metadata.contentType !== contentType ||
    !Number.isSafeInteger(metadataSize) ||
    metadataSize < 1 ||
    metadataSize > MAX_IMAGE_BYTES
  ) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Image is invalid or too large.",
    );
  }
  const [imageBytes] = await file.download();
  if (imageBytes.length !== metadataSize) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Image is invalid or incomplete.",
    );
  }

  let uploadResponse = await uploadGooglePhotosBytes(
    imageBytes,
    contentType,
    accessToken,
    fetchImpl,
  );
  if (uploadResponse.status === 401) {
    const refreshedAccessToken = await getAccessToken(
      firestore,
      userId,
      config,
      fetchImpl,
      GOOGLE_PHOTOS_APPEND_SCOPE,
      { forceRefresh: true },
    );
    accessToken = refreshedAccessToken;
    uploadResponse = await uploadGooglePhotosBytes(
      imageBytes,
      contentType,
      refreshedAccessToken,
      fetchImpl,
    );
  }
  const uploadResponseBody = await uploadResponse.text().catch(() => "");
  const uploadToken = uploadResponseBody.trim();
  if (!uploadResponse.ok) {
    throwGoogleUploadError(uploadResponse, uploadResponseBody);
  }
  if (!uploadToken || uploadToken.length > 4096) {
    console.warn(
      JSON.stringify({
        event: "google_photos_upload_invalid_response",
        status: uploadResponse.status,
      }),
    );
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_UPLOAD_FAILED",
      "Google Photos returned an invalid upload response. Please retry.",
    );
  }

  const filename = `pinboard-studio-${mediaKind}.${extensions[contentType]}`;
  const result = await googleApiRequestWithTokenRefresh(
    firestore,
    userId,
    config,
    `${GOOGLE_LIBRARY_API}/mediaItems:batchCreate`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newMediaItems: [
          {
            simpleMediaItem: { fileName: filename, uploadToken },
          },
        ],
      }),
    },
    fetchImpl,
  );
  const createdItem = result?.newMediaItemResults?.[0];
  if (createdItem?.status?.code || !createdItem?.mediaItem?.id) {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_SAVE_FAILED",
      "Google Photos could not save the image. Please retry.",
    );
  }

  return { saved: true };
}

function validatePickerUri(value) {
  try {
    const pickerUri = new URL(value);
    if (
      pickerUri.protocol !== "https:" ||
      pickerUri.hostname !== "photos.google.com" ||
      pickerUri.port ||
      pickerUri.username ||
      pickerUri.password
    ) {
      throw new Error("Invalid Picker URI.");
    }
    if (!pickerUri.pathname.endsWith("/autoclose")) {
      pickerUri.pathname = `${pickerUri.pathname.replace(/\/$/, "")}/autoclose`;
    }
    return pickerUri.toString();
  } catch {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_INVALID_RESPONSE",
      "Google Photos returned an invalid Picker session. Please retry.",
    );
  }
}

function pickerReference(firestore, userId, appSessionId) {
  return pickerSessionCollection(firestore, userId).doc(appSessionId);
}

async function readPickerSession(
  firestore,
  userId,
  appSessionId,
  { allowExpired = false } = {},
) {
  if (
    typeof appSessionId !== "string" ||
    !/^[\da-f-]{36}$/i.test(appSessionId)
  ) {
    throw new ApiError(404, "NOT_FOUND", "Google Photos session not found.");
  }
  const reference = pickerReference(firestore, userId, appSessionId);
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    throw new ApiError(404, "NOT_FOUND", "Google Photos session not found.");
  }
  const session = snapshot.data();
  if (!allowExpired && session.expiresAt.toDate() <= new Date()) {
    await reference.delete();
    throw new ApiError(
      410,
      "GOOGLE_PHOTOS_SESSION_EXPIRED",
      "This Google Photos selection expired. Start a new selection.",
    );
  }
  return { reference, session };
}

export async function createGooglePhotosPickerSession(
  firestore,
  userId,
  creationId,
  config,
  fetchImpl = fetch,
) {
  const accessToken = await getAccessToken(
    firestore,
    userId,
    config,
    fetchImpl,
  );
  const remote = await googleApiRequest(
    `${GOOGLE_PICKER_API}/sessions`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pickingConfig: { maxItemCount: "10" } }),
    },
    fetchImpl,
  );
  try {
    const pickerUri = validatePickerUri(remote?.pickerUri);
    const expiresAt = new Date(remote?.expireTime || "");
    if (!remote?.id || !Number.isFinite(expiresAt.getTime())) {
      throw new ApiError(
        502,
        "GOOGLE_PHOTOS_INVALID_RESPONSE",
        "Google Photos returned an invalid Picker session. Please retry.",
      );
    }

    const appSessionId = randomUUID();
    await pickerReference(firestore, userId, appSessionId).set({
      creationId,
      googleSessionId: remote.id,
      expiresAt: Timestamp.fromDate(expiresAt),
      createdAt: Timestamp.now(),
    });
    return {
      sessionId: appSessionId,
      pickerUri,
      expireTime: expiresAt.toISOString(),
      pollingConfig: remote.pollingConfig || {
        pollInterval: "3s",
        timeoutIn: "300s",
      },
    };
  } catch (error) {
    if (remote?.id) {
      await googleApiRequest(
        `${GOOGLE_PICKER_API}/sessions/${encodeURIComponent(remote.id)}`,
        accessToken,
        { method: "DELETE" },
        fetchImpl,
      );
    }
    throw error;
  }
}

async function getRemotePickerSession(
  firestore,
  userId,
  appSessionId,
  config,
  fetchImpl,
) {
  const { session } = await readPickerSession(firestore, userId, appSessionId);
  const accessToken = await getAccessToken(
    firestore,
    userId,
    config,
    fetchImpl,
  );
  const remote = await googleApiRequest(
    `${GOOGLE_PICKER_API}/sessions/${encodeURIComponent(session.googleSessionId)}`,
    accessToken,
    {},
    fetchImpl,
  );
  return { session, accessToken, remote };
}

export async function pollGooglePhotosPickerSession(
  firestore,
  userId,
  appSessionId,
  config,
  fetchImpl = fetch,
) {
  const { remote } = await getRemotePickerSession(
    firestore,
    userId,
    appSessionId,
    config,
    fetchImpl,
  );
  return {
    mediaItemsSet: remote?.mediaItemsSet === true,
    expireTime: remote?.expireTime || null,
    pollingConfig: remote?.pollingConfig || null,
  };
}

async function listSelectedMediaItems(remoteSessionId, accessToken, fetchImpl) {
  const items = [];
  let pageToken;
  do {
    const url = new URL(`${GOOGLE_PICKER_API}/mediaItems`);
    url.searchParams.set("sessionId", remoteSessionId);
    url.searchParams.set("pageSize", String(MAX_SELECTED_ITEMS));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await googleApiRequest(
      url.toString(),
      accessToken,
      {},
      fetchImpl,
    );
    items.push(...(Array.isArray(page?.mediaItems) ? page.mediaItems : []));
    pageToken = page?.nextPageToken;
  } while (pageToken && items.length < MAX_SELECTED_ITEMS);
  return items.slice(0, MAX_SELECTED_ITEMS);
}

export async function listGooglePhotosPickerItems(
  firestore,
  userId,
  appSessionId,
  config,
  fetchImpl = fetch,
) {
  const { session, accessToken, remote } = await getRemotePickerSession(
    firestore,
    userId,
    appSessionId,
    config,
    fetchImpl,
  );
  if (remote?.mediaItemsSet !== true) {
    throw new ApiError(
      409,
      "GOOGLE_PHOTOS_SELECTION_PENDING",
      "Finish selecting photos in Google Photos before loading the selection.",
    );
  }
  const items = await listSelectedMediaItems(
    session.googleSessionId,
    accessToken,
    fetchImpl,
  );
  return {
    mediaItems: items
      .filter(
        (item) =>
          typeof item?.id === "string" &&
          item?.type === "PHOTO" &&
          ["image/jpeg", "image/png", "image/webp"].includes(
            item?.mediaFile?.mimeType,
          ),
      )
      .map((item) => ({
        id: item.id,
        filename: item.mediaFile.filename || "Google Photos image",
        mimeType: item.mediaFile.mimeType,
        width: item.mediaFile.mediaFileMetadata?.width || null,
        height: item.mediaFile.mediaFileMetadata?.height || null,
      })),
  };
}

function isGoogleMediaHost(hostname) {
  return (
    hostname === GOOGLE_MEDIA_HOST || hostname.endsWith(`.${GOOGLE_MEDIA_HOST}`)
  );
}

function validateGoogleMediaUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_INVALID_RESPONSE",
      "Google Photos returned an invalid media URL.",
    );
  }
  if (
    url.protocol !== "https:" ||
    !isGoogleMediaHost(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_INVALID_RESPONSE",
      "Google Photos returned an invalid media URL.",
    );
  }
  return url;
}

async function readBoundedBody(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      "The selected photo is larger than 10 MB. Choose a smaller image.",
    );
  }
  if (!response.body) {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_INVALID_RESPONSE",
      "Google Photos returned an empty image.",
    );
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new ApiError(
        413,
        "PAYLOAD_TOO_LARGE",
        "The selected photo is larger than 10 MB. Choose a smaller image.",
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function downloadGooglePhoto(baseUrl, accessToken, fetchImpl) {
  let target = validateGoogleMediaUrl(`${baseUrl}=d`);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response;
    try {
      response = await fetchImpl(target, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "manual",
        signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(
        502,
        "GOOGLE_PHOTOS_UNAVAILABLE",
        "The selected photo could not be downloaded. Please select it again.",
      );
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) {
        throw new ApiError(
          502,
          "GOOGLE_PHOTOS_INVALID_RESPONSE",
          "Google Photos returned an invalid media redirect.",
        );
      }
      target = validateGoogleMediaUrl(new URL(location, target).toString());
      continue;
    }
    if (!response.ok) {
      throw new ApiError(
        502,
        "GOOGLE_PHOTOS_MEDIA_UNAVAILABLE",
        "The selected photo could not be downloaded. Select it again and retry.",
      );
    }
    return readBoundedBody(response);
  }
  throw new ApiError(
    502,
    "GOOGLE_PHOTOS_INVALID_RESPONSE",
    "Google Photos returned too many media redirects.",
  );
}

async function deleteRemotePickerSession(session, accessToken, fetchImpl) {
  await googleApiRequest(
    `${GOOGLE_PICKER_API}/sessions/${encodeURIComponent(session.googleSessionId)}`,
    accessToken,
    { method: "DELETE" },
    fetchImpl,
  );
}

function wrapMediaImportFailure(error) {
  if (error instanceof ApiError) return error;
  console.error("Google Photos media import storage failure:", error);
  const detail =
    process.env.NODE_ENV === "production" ? "" : ` (${error.message})`;
  const wrapped = new ApiError(
    502,
    "MEDIA_IMPORT_FAILED",
    `The selected photo could not be stored. Please retry the import.${detail}`,
  );
  wrapped.cause = error;
  return wrapped;
}

async function stageImportedMedia(
  firestore,
  bucket,
  userId,
  creationId,
  contentType,
  imageBytes,
  fetchImpl,
) {
  try {
    return await stageMediaUploadBuffer(
      firestore,
      bucket,
      userId,
      creationId,
      "sourceImage",
      contentType,
      imageBytes,
    );
  } catch (directUploadError) {
    let upload;
    try {
      upload = await createMediaUpload(
        firestore,
        bucket,
        userId,
        creationId,
        "sourceImage",
        { contentType, sizeBytes: imageBytes.length },
      );
      const response = await fetchImpl(upload.uploadUrl, {
        method: upload.method,
        headers: upload.headers,
        body: imageBytes,
        signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        const detail = responseBody.replace(/\s+/g, " ").trim().slice(0, 240);
        throw new Error(
          `Signed media upload failed with status ${response.status}${detail ? `: ${detail}` : "."}`,
        );
      }
      return upload;
    } catch (signedUploadError) {
      if (upload?.uploadId) {
        await discardMediaUpload(firestore, bucket, userId, upload.uploadId);
      }
      if (process.env.NODE_ENV !== "production") {
        signedUploadError.message = `${signedUploadError.message} Direct upload also failed: ${directUploadError.message}`;
      }
      signedUploadError.cause = directUploadError;
      throw signedUploadError;
    }
  }
}

export async function deleteGooglePhotosPickerSession(
  firestore,
  userId,
  appSessionId,
  config,
  fetchImpl = fetch,
) {
  const { reference, session } = await readPickerSession(
    firestore,
    userId,
    appSessionId,
    { allowExpired: true },
  );
  const accessToken = await getAccessToken(
    firestore,
    userId,
    config,
    fetchImpl,
  );
  await deleteRemotePickerSession(session, accessToken, fetchImpl);
  await reference.delete();
  return { deleted: true };
}

export async function deleteGooglePhotosPickerSessionsForCreation(
  firestore,
  userId,
  creationId,
  config,
  fetchImpl = fetch,
) {
  const sessions = await pickerSessionCollection(firestore, userId)
    .where("creationId", "==", creationId)
    .get();
  if (sessions.empty) return;

  let accessToken;
  try {
    accessToken = await getAccessToken(firestore, userId, config, fetchImpl);
  } catch {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_CLEANUP_FAILED",
      "Google Photos selection cleanup could not be confirmed. Reconnect Google Photos and retry.",
    );
  }

  const deletionResults = await Promise.allSettled(
    sessions.docs.map((document) =>
      deleteRemotePickerSession(document.data(), accessToken, fetchImpl),
    ),
  );
  await Promise.all(sessions.docs.map((document) => document.ref.delete()));
  if (deletionResults.some((result) => result.status === "rejected")) {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_CLEANUP_FAILED",
      "Google Photos selection cleanup could not be confirmed. The sessions will expire automatically.",
    );
  }
}

export async function importGooglePhotosPickerItem(
  firestore,
  bucket,
  userId,
  creationId,
  appSessionId,
  mediaItemId,
  config,
  fetchImpl = fetch,
) {
  const { reference, session } = await readPickerSession(
    firestore,
    userId,
    appSessionId,
  );
  if (session.creationId !== creationId) {
    throw new ApiError(404, "NOT_FOUND", "Google Photos session not found.");
  }

  let uploadId;
  let importedMedia;
  let importError;
  try {
    const accessToken = await getAccessToken(
      firestore,
      userId,
      config,
      fetchImpl,
    );
    const remote = await googleApiRequest(
      `${GOOGLE_PICKER_API}/sessions/${encodeURIComponent(session.googleSessionId)}`,
      accessToken,
      {},
      fetchImpl,
    );
    if (remote?.mediaItemsSet !== true) {
      throw new ApiError(
        409,
        "GOOGLE_PHOTOS_SELECTION_PENDING",
        "Finish selecting photos in Google Photos before importing one.",
      );
    }

    const selected = await listSelectedMediaItems(
      session.googleSessionId,
      accessToken,
      fetchImpl,
    );
    const item = selected.find((candidate) => candidate?.id === mediaItemId);
    if (
      !item ||
      item.type !== "PHOTO" ||
      !["image/jpeg", "image/png", "image/webp"].includes(
        item.mediaFile?.mimeType,
      ) ||
      typeof item.mediaFile?.baseUrl !== "string"
    ) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Choose a supported photo from this Google Photos selection.",
      );
    }

    const imageBytes = await downloadGooglePhoto(
      item.mediaFile.baseUrl,
      accessToken,
      fetchImpl,
    );
    if (!imageBytes.length) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Google Photos returned an empty image. Select another photo.",
      );
    }

    try {
      const upload = await stageImportedMedia(
        firestore,
        bucket,
        userId,
        creationId,
        item.mediaFile.mimeType,
        imageBytes,
        fetchImpl,
      );
      uploadId = upload.uploadId;
      let stored;
      try {
        stored = await completeMediaUpload(
          firestore,
          bucket,
          userId,
          creationId,
          upload.uploadId,
          { importedFrom: "google_photos_picker" },
        );
      } catch (error) {
        await discardMediaUpload(firestore, bucket, userId, upload.uploadId);
        throw wrapMediaImportFailure(error);
      }
      if (!stored) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "The selected photo is invalid or no longer available. Choose another photo.",
        );
      }
      importedMedia = stored;
      uploadId = undefined;
    } catch (error) {
      throw wrapMediaImportFailure(error);
    }
  } catch (error) {
    importError = error;
  }

  if (uploadId) {
    await discardMediaUpload(firestore, bucket, userId, uploadId);
  }
  try {
    const accessToken = await getAccessToken(
      firestore,
      userId,
      config,
      fetchImpl,
    );
    await deleteRemotePickerSession(session, accessToken, fetchImpl);
    await reference.delete();
  } catch {
    throw new ApiError(
      502,
      "GOOGLE_PHOTOS_CLEANUP_FAILED",
      "The Picker selection could not be fully cleaned up. Retry or start a new selection.",
    );
  }
  if (importError) throw importError;
  return importedMedia;
}

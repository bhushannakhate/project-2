# Pinboard Studio — Project Architecture and Data Reference

**Last verified:** 2026-11-11
**Canonical Google/Firebase project:** `project-2-pinboard-2026`
**Repository:** [bhushannakhate/project-2](https://github.com/bhushannakhate/project-2)

This document records the currently implemented and deployed architecture. Firestore is a document database, not a relational database: the “table” definitions below are collection/document schemas. Fields that are optional or legacy are identified explicitly.

## 1. Application architecture

```text
Browser (Pinboard Studio)
  ├─ Firebase Authentication: user signs in and obtains an ID token
  ├─ HTTPS API requests carrying a Firebase ID token in the Authorization header
  │    └─ Cloud Run: Express 5 API
  │         ├─ Firebase Admin verifies ID tokens
  │         ├─ Firestore stores profiles, creations, and upload sessions
  │         ├─ Google Photos Picker API handles explicit photo selection
  │         └─ Google Cloud Storage stores private media objects
  ├─ Direct media bytes upload to a short-lived signed Cloud Storage URL
  └─ Google Photos imports are downloaded and validated by the API before storage
```

The API is the trusted boundary for user-scoped application data. It verifies the Firebase token, derives the UID from that verified token, and scopes Firestore paths to that UID. The API uses the Google Cloud Storage SDK for media. Media bytes are not stored in Firestore; Firestore stores private object references and metadata.

## 2. Application and administration URLs

### User-facing services

| Service                            | URL                                                                                                          | Notes                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Pinboard Studio (Firebase Hosting) | [project-2-pinboard-2026.web.app/account](https://project-2-pinboard-2026.web.app/account)                   | Current hosted account page.                                                                                                          |
| API base URL                       | [project-2-api-m5lsuu6ouq-uc.a.run.app](https://project-2-api-m5lsuu6ouq-uc.a.run.app)                       | Production API; append `/api` endpoints below.                                                                                        |
| API health                         | [project-2-api-m5lsuu6ouq-uc.a.run.app/api/health](https://project-2-api-m5lsuu6ouq-uc.a.run.app/api/health) | Should return `{"status":"ok"}`.                                                                                                      |
| Earlier/alternate UI deployment    | [project-1-ui-m5lsuu6ouq-uc.a.run.app](https://project-1-ui-m5lsuu6ouq-uc.a.run.app)                         | Cloud Run UI URL still present in deployment documentation and bucket CORS. Confirm which UI deployment is active before removing it. |

### Firebase and Google Cloud consoles

All console links below refer to the canonical `project-2-pinboard-2026` project.

| Component                     | Console URL                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase project overview     | [Firebase Console](https://console.firebase.google.com/project/project-2-pinboard-2026/overview)                                                                |
| Firebase Authentication users | [Authentication → Users](https://console.firebase.google.com/project/project-2-pinboard-2026/authentication/users)                                              |
| Firestore data                | [Firestore → Data](https://console.firebase.google.com/project/project-2-pinboard-2026/firestore/databases/-default-/data)                                      |
| Cloud Run API service         | [Cloud Run → project-2-api](https://console.cloud.google.com/run/detail/us-central1/project-2-api?project=project-2-pinboard-2026)                              |
| Media bucket                  | [Cloud Storage → project-2-pinboard-2026-media](https://console.cloud.google.com/storage/browser/project-2-pinboard-2026-media?project=project-2-pinboard-2026) |
| Runtime service account       | [IAM → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=project-2-pinboard-2026)                                            |
| Cloud Run logs                | [Logs Explorer](https://console.cloud.google.com/logs/query?project=project-2-pinboard-2026)                                                                    |

The API URL and the console links are different: the API serves requests; the Firebase and Google Cloud consoles are administrative interfaces.

## 3. Firebase and Google Cloud resources

| Resource                                 | Current configuration                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Google Cloud / Firebase project          | `project-2-pinboard-2026` (project number `663031487507`)                                                                    |
| Cloud Run service                        | `project-2-api`, region `us-central1`                                                                                        |
| Production Cloud Run URL                 | `https://project-2-api-m5lsuu6ouq-uc.a.run.app`                                                                              |
| Production revision at last verification | `project-2-api-00011-ros`                                                                                                    |
| Cloud Run runtime identity               | `pinboard-api-runtime@project-2-pinboard-2026.iam.gserviceaccount.com`                                                       |
| Local development Storage identity       | `pinboard-local-bhushan@project-2-pinboard-2026.iam.gserviceaccount.com`                                                     |
| Firestore                                | `(default)` database in Native mode                                                                                          |
| Cloud Storage bucket                     | `gs://project-2-pinboard-2026-media`, regional `US-CENTRAL1`, Standard storage                                               |
| Bucket security                          | Public access prevention enforced; uniform bucket-level access enabled; soft delete disabled for immediate deletion behavior |
| Staging object cleanup                   | Bucket lifecycle deletes objects under `staging/` after one day                                                              |
| Upload-session cleanup                   | Firestore TTL on `mediaUploadSessions.expiresAt` is active                                                                   |
| Firebase Storage security rules          | Deny client reads/writes. Production media access uses the GCS bucket and short-lived signed URLs instead.                   |

The runtime service account has bucket-scoped `roles/storage.objectAdmin` and `roles/iam.serviceAccountTokenCreator` on itself for signed URL generation. The local `bhushan` development service account also has bucket-scoped `roles/storage.objectAdmin` so the server-side Google Photos import and local media tests can write staging objects. Grant the equivalent bucket role to any other local profile before using it; do not grant client users direct bucket IAM access. Do not put service-account keys, Firebase ID tokens, signed URLs, or database credentials in this document or source control. Signed URLs are bearer links while valid.

### Browser-origin configuration note

At the last configuration check, the API's allowed web origins included the Firebase Hosting site, while the bucket's direct-upload CORS list included the older Cloud Run UI and local development origins. Before using direct browser media uploads from Firebase Hosting, ensure `https://project-2-pinboard-2026.web.app` is included in both:

- `WEB_ORIGIN` on the API service, and
- `config/media-bucket-cors.json` and the live bucket CORS policy.

The API upload/download URL endpoints themselves are authenticated; bucket CORS controls browser access to the direct signed-URL transfer.

## 4. Authentication and request flow

1. A user signs in through Firebase Authentication in the web client.
2. The client sends the Firebase ID token in the `Authorization` request header in the format expected by the API.
3. Express middleware verifies the token with Firebase Admin. An invalid or expired token receives `401 UNAUTHENTICATED`.
4. The verified token UID determines the profile and creation paths in Firestore. The client cannot choose another user's UID to access those records.
5. For media, the API issues a short-lived upload URL, validates the completed object, and returns a short-lived download URL only after checking ownership.

Firebase Auth user records are managed by Firebase Authentication, not stored as a Firestore collection. A Firestore profile is created on the first `GET /api/users/me`.

The Firebase Auth UID is the stable identity key used by Firestore paths. Firebase-managed account information includes fields such as email, display name, and photo URL; which sign-in providers are enabled is controlled in the Firebase Authentication console.

## 5. Firestore collection and document definitions

### `users/{uid}` — authenticated user profile

One profile per Firebase Authentication UID.

| Field          | Type                | Meaning                                                                     |
| -------------- | ------------------- | --------------------------------------------------------------------------- |
| `uid`          | string              | Firebase Auth UID; matches the document ID.                                 |
| `email`        | string              | Email from the verified Firebase user, or empty string if unavailable.      |
| `displayName`  | string              | Display name from Firebase; user may update it.                             |
| `photoURL`     | string              | Profile photo URL from Firebase; user may update it.                        |
| `credits`      | number              | Starts at `0`; server-managed. Credits feature/Jira #4 is not implemented.  |
| `subscription` | string              | Starts at `"free"`; server-managed.                                         |
| `pinterest`    | map                 | Starts as `{ "connected": false }`; integration details may be added later. |
| `createdAt`    | Firestore timestamp | Profile creation time.                                                      |
| `updatedAt`    | Firestore timestamp | Latest profile update time.                                                 |

The profile PATCH API currently accepts only `displayName` and `photoURL`.

### `users/{uid}/creations/{creationId}` — Pinboard creation

One user-owned document per design/creation. New documents have a Firestore-generated ID.

| Field            | Type                | Meaning                                                                                  |
| ---------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `userId`         | string              | Owner UID, set by the API.                                                               |
| `sourceImageUrl` | string              | Optional legacy HTTP(S) URL. New managed files use `media.sourceImage`.                  |
| `outputImageUrl` | string              | Optional legacy HTTP(S) URL. New managed files use `media.outputImage`.                  |
| `audioUrl`       | string              | Optional legacy HTTP(S) URL. New managed files use `media.audio`.                        |
| `instructions`   | string              | Optional user prompt/instructions, maximum 2,000 characters.                             |
| `status`         | string              | `draft`, `processing`, `completed`, or `failed`; defaults to `draft`.                    |
| `metadata`       | map                 | Optional JSON object, maximum 4 KB.                                                      |
| `pinterest`      | map                 | Optional JSON object, maximum 4 KB.                                                      |
| `media`          | map                 | Server-managed media references; starts empty. See the media reference definition below. |
| `revisionCount`  | number              | Server-managed; starts at `0`.                                                           |
| `isDeleted`      | boolean             | Soft-delete marker; starts `false`. Deleted creations are hidden from reads/lists.       |
| `createdAt`      | Firestore timestamp | Creation time.                                                                           |
| `updatedAt`      | Firestore timestamp | Latest update time.                                                                      |
| `deletedAt`      | Firestore timestamp | Set when the creation is soft-deleted.                                                   |

`sourceImageUrl`, `outputImageUrl`, and `audioUrl` remain accepted for compatibility with existing clients. A creation can now be created without those URL fields and then use the managed media upload flow.

The `media` map contains zero or more of these kind keys: `sourceImage`, `outputImage`, `audio`. Each populated entry has:

| Field         | Type   | Meaning                                       |
| ------------- | ------ | --------------------------------------------- |
| `objectPath`  | string | Private bucket object name; not a public URL. |
| `contentType` | string | Validated MIME type.                          |
| `sizeBytes`   | number | Verified object size in bytes.                |
| `updatedAt`   | string | ISO timestamp for the attached file.          |

### `users/{uid}/mediaUploadSessions/{uploadId}` — temporary upload tracking

Created when an upload URL is requested. Pending sessions are removed when upload completion succeeds, when the creation is deleted, or when an expired session is handled. Firestore TTL also expires documents based on `expiresAt`.

| Field         | Type                | Meaning                                                        |
| ------------- | ------------------- | -------------------------------------------------------------- |
| `creationId`  | string              | Creation to which the media belongs.                           |
| `mediaKind`   | string              | `sourceImage`, `outputImage`, or `audio`.                      |
| `contentType` | string              | Expected MIME type.                                            |
| `sizeBytes`   | number              | Expected size; checked against the uploaded object's metadata. |
| `stagingPath` | string              | Temporary object path under `staging/{uid}/{creationId}/...`.  |
| `status`      | string              | Currently `pending` while the upload is awaiting completion.   |
| `expiresAt`   | Firestore timestamp | Upload URL/session expiration; Firestore TTL field.            |
| `createdAt`   | Firestore timestamp | Session creation time.                                         |

The session is temporary operational data, not a permanent media record.

### Firestore indexes

The repository's `firestore.indexes.json` defines these collection-group indexes for `creations`:

1. `status` ascending + `updatedAt` descending
2. `isDeleted` ascending + `createdAt` descending
3. `isDeleted` ascending + `status` ascending + `createdAt` descending

The active Firestore TTL policy is on field `expiresAt` for the `mediaUploadSessions` collection group. Index definitions are maintained in `firestore.indexes.json`; the TTL policy is configured separately in the project.

### Access rules

- `firestore.rules` lets a signed-in client read its own profile and own creation documents; other users' documents and all unmatched documents are denied.
- Profile client writes are blocked from changing `credits`, `subscription`, and `role`.
- The API uses Firebase Admin credentials, which bypass Firestore Security Rules; API handlers must continue enforcing ownership and allowed fields.
- `storage.rules` denies all Firebase Storage client access. Production media objects are accessed through the private GCS bucket, whose bucket IAM policy and signed URLs control access.

## 6. Cloud Storage media lifecycle

### Object naming

```text
staging/{uid}/{creationId}/{uploadId}
users/{uid}/creations/{creationId}/{mediaKind}/{uploadId}
```

The final object path is saved in `creations.media.{mediaKind}.objectPath`. Object bytes remain in Cloud Storage; Firestore contains references/metadata only.

### Upload and access policy

- Media kinds: `sourceImage`, `outputImage`, `audio`.
- Images: JPEG, PNG, or WebP; maximum 10 MiB.
- Audio: MPEG, MP4, OGG, WAV, or WebM; maximum 25 MiB.
- Upload URL validity: 10 minutes.
- Download URL validity: 5 minutes.
- Completion validates the actual object size and MIME type before moving it from staging to its final owner/creation path.
- Replacing a media kind removes the previous final object.
- Deleting a creation deletes its final objects and pending staged objects, then soft-deletes the Firestore creation.
- Abandoned staging objects are lifecycle-deleted after one day; upload-session documents expire through Firestore TTL.

Direct upload endpoints, where `:mediaKind` is one of the supported kinds:

| Method | API path                                                      | Purpose                                                                                             |
| ------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST` | `/api/creations/:creationId/media/:mediaKind/uploads`         | Create upload session and signed upload URL. Body: `{"contentType":"image/png","sizeBytes":12345}`. |
| `POST` | `/api/creations/:creationId/media/uploads/:uploadId/complete` | Verify upload and attach its reference to the creation.                                             |
| `GET`  | `/api/creations/:creationId/media/:mediaKind/download-url`    | Return an ownership-checked signed download URL.                                                    |

### Google Photos Picker import

Google Photos is an explicit, owner-bound import path. The browser never sends a Google media URL directly to Cloud Storage and the API never stores a Google base URL in Firestore.

1. The API starts the OAuth authorization-code flow with PKCE and the narrow Picker scope `photospicker.mediaitems.readonly`.
2. Encrypted Google OAuth tokens are stored at `users/{uid}/integrations/googlePhotos`; the encryption key is supplied by `GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY`.
3. The API creates a Google Picker session and stores its owner and creation binding at `users/{uid}/googlePhotosSessions/{sessionId}`.
4. The browser opens the returned Picker URI, then asks the API for the selected item metadata. Only photo items with JPEG, PNG, or WebP MIME types are exposed.
5. On import, the API verifies the creation and session ownership, confirms the item belongs to the selected Picker session, validates the Google media host, downloads the bytes server-side, and enforces the 10 MiB image limit.
6. The bytes enter the same staging and `completeMediaUpload` validation pipeline as direct uploads. The image is normalized, attached to `media.sourceImage`, and served later through an ownership-checked signed download URL.
7. The remote Picker session and local session record are deleted after a successful import or after a handled import failure.

The preferred import path writes the downloaded bytes to the bucket through the Cloud Storage SDK. A signed-upload fallback is retained for environments where direct SDK staging is unavailable. Both paths require the API's service account to have bucket-scoped object-create/read/delete access; a missing `storage.objects.create` permission produces a storage import failure rather than a partial media record.

Google Photos routes:

| Method   | Path                                                                  | Purpose                                                            |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET`    | `/api/google-photos/connection`                                       | Read the caller's Google Photos connection status.                 |
| `POST`   | `/api/google-photos/oauth/authorize`                                  | Start the state- and PKCE-protected OAuth flow.                    |
| `GET`    | `/api/google-photos/oauth/callback`                                   | Consume the one-use OAuth state and store encrypted tokens.        |
| `DELETE` | `/api/google-photos/connection`                                       | Revoke Google access and remove encrypted tokens.                  |
| `POST`   | `/api/creations/:creationId/google-photos/sessions`                   | Create a creation-bound Picker session.                            |
| `GET`    | `/api/google-photos/sessions/:sessionId`                              | Poll Picker session readiness.                                     |
| `GET`    | `/api/google-photos/sessions/:sessionId/media-items`                  | List selected photo metadata without exposing temporary base URLs. |
| `POST`   | `/api/creations/:creationId/google-photos/sessions/:sessionId/import` | Download, validate, store, and attach one selected photo.          |
| `DELETE` | `/api/google-photos/sessions/:sessionId`                              | Cancel a Picker session and remove its local record.               |

## 7. API route inventory

All routes below are served from `https://project-2-api-m5lsuu6ouq-uc.a.run.app`. Except for health, they require a Firebase ID token.

| Method   | Path                                                          | Purpose                                                      |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET`    | `/api/health`                                                 | Health probe; no authentication required.                    |
| `GET`    | `/api/users/me`                                               | Get or initialize the caller's profile.                      |
| `PATCH`  | `/api/users/me`                                               | Update the caller's `displayName` and/or `photoURL`.         |
| `GET`    | `/api/creations?limit=&status=&cursor=`                       | List caller's non-deleted creations, paginated.              |
| `GET`    | `/api/creations/:creationId`                                  | Get one owned, non-deleted creation.                         |
| `POST`   | `/api/creations`                                              | Create a creation.                                           |
| `PATCH`  | `/api/creations/:creationId`                                  | Update allowed creation fields.                              |
| `DELETE` | `/api/creations/:creationId`                                  | Delete associated media and soft-delete the creation record. |
| `POST`   | `/api/creations/:creationId/media/:mediaKind/uploads`         | Start a direct media upload.                                 |
| `POST`   | `/api/creations/:creationId/media/uploads/:uploadId/complete` | Finalize a direct upload.                                    |
| `GET`    | `/api/creations/:creationId/media/:mediaKind/download-url`    | Request short-lived access to owned media.                   |

### Optional legacy/demo MongoDB API

MongoDB is not used by normal app startup and is separate from authentication, profiles, creations, and media. If `DEMO_CUSTOMERS_ENABLED=true`, the API connects to the configured MongoDB URI, database `project2` by default, collection `customers`, and creates a unique index on `email`.

| Customer field      | Type             | Rules/default                                                            |
| ------------------- | ---------------- | ------------------------------------------------------------------------ |
| `_id`               | MongoDB ObjectId | Returned by the API as string `id`.                                      |
| `fullName`          | string           | Required, maximum 100 characters.                                        |
| `email`             | string           | Required, lowercased, valid email, maximum 254 characters, unique index. |
| `username`          | string           | Required, maximum 30 characters; letters, numbers, `.`, `_`, `-`.        |
| `phone`             | string           | Optional; defaults to empty string; maximum 30 characters.               |
| `bio`               | string           | Optional; defaults to empty string; maximum 500 characters.              |
| `preferredCategory` | string           | Optional; defaults to `General inspiration`; maximum 80 characters.      |
| `interests`         | string array     | Optional; defaults to empty; up to 20 items, each up to 50 characters.   |
| `marketingOptIn`    | boolean          | Optional; defaults to `false`.                                           |
| `createdAt`         | date             | Set by the API on insert.                                                |
| `updatedAt`         | date             | Set by the API on update.                                                |

The optional routes are `GET/POST /api/demo/customers`, `PATCH /api/demo/customers/:id`, and `DELETE /api/demo/customers/:id`. They are not the application's user or creation database, and currently do not use Firebase authentication middleware. Keep the demo disabled unless it is intentionally needed and secured.

## 8. Features not represented by these schemas

- Credits/subscription fields exist on the user profile, but credit accounting and subscription workflows are not implemented (tracked separately as Jira #4).
- Creation statuses are stored, but this API does not include a generation worker, job queue, or connected image-generation provider.
- Pinterest fields are placeholders for integration data; the Pinterest integration itself is not implemented here.

## 9. Source-of-truth files and operations

| Topic                                         | Repository location                   |
| --------------------------------------------- | ------------------------------------- |
| API endpoint list and developer setup         | `README.md`                           |
| Firebase project/bucket environment variables | `.env.example`                        |
| Firebase Admin initialization                 | `src/config/firebase.js`              |
| Firestore profile and creation operations     | `src/services/firestoreService.js`    |
| Media storage lifecycle                       | `src/services/mediaStorageService.js` |
| Google Photos OAuth, Picker, and import flow  | `src/services/googlePhotosService.js` |
| Firestore security rules                      | `firestore.rules`                     |
| Firestore indexes                             | `firestore.indexes.json`              |
| Firebase Storage rules (deny-all)             | `storage.rules`                       |
| Bucket browser CORS                           | `config/media-bucket-cors.json`       |
| Bucket lifecycle cleanup                      | `config/media-bucket-lifecycle.json`  |
| Production/test emulator configuration        | `firebase.json`, `firebase.test.json` |
| CI checks                                     | `.github/workflows/ci.yml`            |

The emulator configuration `firebase.test.json` uses permissive Storage rules only for local tests. Do not deploy it to production. Cloud resource configuration can drift from repository files; verify the live project before changing or deleting resources.

# Project 2 API

[![CI](https://github.com/bhushannakhate/project-2/actions/workflows/ci.yml/badge.svg)](https://github.com/bhushannakhate/project-2/actions/workflows/ci.yml)

Maintainable Express 5 API for the Pinboard Studio application. The normal server startup does not connect to MongoDB. Firebase/Firestore APIs are mounted under `/api`; the legacy MongoDB customer API is an opt-in demo available only at `/api/demo/customers`.

## Deployment

- **API service:** https://project-2-api-m5lsuu6ouq-uc.a.run.app
- **Project:** `project-2-pinboard-2026`
- **Region:** `us-central1`
- **UI:** https://project-1-ui-m5lsuu6ouq-uc.a.run.app

## Project planning

- [Pinboard Studio execution plan and rubric map](docs/Pinboard-Studio-Execution-Plan.pdf)

## Requirements and startup

Use Node.js 20 or newer. Copy `.env.example` to `.env`, configure Firebase credentials for the selected profile, then run:

```sh
npm install
npm run dev
```

Use `npm start` for normal startup. The API listens on port `4000` by default. `PORT`, `NODE_ENV`, and the comma-separated browser origins in `WEB_ORIGIN` can be customized. Requests without an `Origin` header are allowed for health probes and command-line clients. The server applies Helmet security headers, logs requests, and limits JSON bodies to 20kb.

Run `npm run firebase:check` to verify the selected Firebase project and service-account configuration. The canonical Firebase project is `project-2-pinboard-2026`; keep service-account files private in the ignored `credentials/` directory. Production uses a dedicated Cloud Run service account and workload identity.

## Health and error responses

`GET /api/health` returns `200` with:

```json
{ "status": "ok" }
```

API errors use one response shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found: GET /api/unknown"
  }
}
```

Error codes include `VALIDATION_ERROR`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `CORS_ORIGIN_DENIED`, `UNAUTHENTICATED`, `NOT_FOUND`, `CONFLICT`, `GOOGLE_PHOTOS_NOT_CONFIGURED`, `GOOGLE_PHOTOS_REAUTH_REQUIRED`, `GOOGLE_PHOTOS_SESSION_EXPIRED`, and `INTERNAL_SERVER_ERROR`.

## Firestore API

All Firestore endpoints require `Authorization: Bearer <Firebase ID token>`.

| Method   | Endpoint                                                              | Purpose                                                    |
| -------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET`    | `/api/users/me`                                                       | Get or initialize the authenticated user profile.          |
| `PATCH`  | `/api/users/me`                                                       | Update allowed profile fields (`displayName`, `photoURL`). |
| `GET`    | `/api/creations?limit=20&status=draft&cursor=<creationId>`            | List the user's creations.                                 |
| `GET`    | `/api/creations/:creationId`                                          | Get one owned creation.                                    |
| `POST`   | `/api/creations`                                                      | Create a creation.                                         |
| `PATCH`  | `/api/creations/:creationId`                                          | Update an owned creation.                                  |
| `DELETE` | `/api/creations/:creationId`                                          | Soft-delete an owned creation.                             |
| `POST`   | `/api/creations/:creationId/media/:mediaKind/uploads`                 | Start a short-lived source/output/audio upload.            |
| `POST`   | `/api/creations/:creationId/media/uploads/:uploadId/complete`         | Validate and attach an uploaded file to the creation.      |
| `GET`    | `/api/creations/:creationId/media/:mediaKind/download-url`            | Get a short-lived URL for owned media.                     |
| `GET`    | `/api/google-photos/connection`                                       | Get the current user's Google Photos connection status.    |
| `POST`   | `/api/google-photos/oauth/authorize`                                  | Start the state- and PKCE-protected Google OAuth flow.     |
| `GET`    | `/api/google-photos/oauth/callback`                                   | Google OAuth callback; protected by one-use server state.  |
| `DELETE` | `/api/google-photos/connection`                                       | Revoke and remove the current user's Google Photos tokens. |
| `POST`   | `/api/creations/:creationId/google-photos/sessions`                   | Create an owner-bound Google Photos Picker session.        |
| `GET`    | `/api/google-photos/sessions/:sessionId`                              | Poll the owner-bound Picker session.                       |
| `GET`    | `/api/google-photos/sessions/:sessionId/media-items`                  | List selected photos without exposing temporary base URLs. |
| `POST`   | `/api/creations/:creationId/google-photos/sessions/:sessionId/import` | Import one selected photo through media validation.        |
| `DELETE` | `/api/google-photos/sessions/:sessionId`                              | Delete the Picker session and its local session record.    |

Create a creation with `instructions`, `status`, and optional JSON-object `metadata` / `pinterest` values (up to 4 KB each). Existing clients may still provide absolute HTTP(S) `sourceImageUrl`, `outputImageUrl`, or `audioUrl` values during the transition; new media must use the managed upload routes. Creation ownership and server-managed fields cannot be supplied by clients. List requests default to 20 results and accept `limit` from 1 to 100, a supported `status`, and the `nextCursor` from the previous response. Deleted creations are hidden from reads and lists.

Media lifecycle:

1. Request an upload with `mediaKind` set to `sourceImage`, `outputImage`, or `audio` and JSON `{ "contentType": "image/png", "sizeBytes": 12345 }`. Images are limited to 10 MB; audio is limited to 25 MB. The response includes a 10-minute upload URL, method, and required headers.
2. Upload the raw file bytes directly to that URL using the returned method and headers. Do not send the file to the API server.
3. Call the completion endpoint with the returned `uploadId`. The API checks actual object size and content type. Source/output images must decode as JPEG, PNG, or WebP, match the declared content type, contain one frame, and fit within 10 MiB, 10,000 pixels per side, and 40 million total pixels. Images are orientation-corrected and re-encoded to strip embedded metadata before they are stored. A creation has one current source image; a successful replacement removes the previous source object. Firestore records the private object path, content type, size, dimensions, and update time in the creation's `media` map.
4. Request a download URL for a specific media kind when needed. It expires after 5 minutes. URLs are bearer links while valid and should not be stored.
5. Deleting a creation removes its media and pending upload sessions. Failed or abandoned staged objects are automatically deleted by the bucket lifecycle rule after one day; expired Firestore upload sessions use the `expiresAt` TTL policy.

Set `MEDIA_STORAGE_BUCKET` to the dedicated private bucket name. The bucket must have public access prevention and uniform bucket-level access enabled. `config/media-bucket-cors.json` and `config/media-bucket-lifecycle.json` configure direct browser uploads and one-day staging cleanup. The Cloud Run runtime service account needs object-level bucket access and permission to sign URLs. Never make this bucket public.

### Google Photos Picker setup

The Google Photos Picker API must be enabled in the canonical Google Cloud project. Configure a Google OAuth web client with the exact callback URI `https://project-2-api-m5lsuu6ouq-uc.a.run.app/api/google-photos/oauth/callback` in production and `http://localhost:4000/api/google-photos/oauth/callback` for local development. Add the corresponding frontend origins to the OAuth client and API `WEB_ORIGIN`. Use Google's current OAuth verification and test-user requirements before production use.

Set `GOOGLE_PHOTOS_CLIENT_ID`, `GOOGLE_PHOTOS_CLIENT_SECRET`, `GOOGLE_PHOTOS_REDIRECT_URI`, and `GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY` on the API. Generate a 32-byte encryption key locally with `openssl rand -base64 32`; keep the OAuth client secret and encryption key in Secret Manager for Cloud Run, never in source control or frontend configuration. The API requests only `photospicker.mediaitems.readonly`; it stores user tokens AES-256-GCM encrypted in server-only Firestore documents. Replacing the encryption key without re-encrypting existing documents makes existing connections unreadable.

OAuth states and Picker session records have an `expiresAt` field. Enable Firestore TTL for both collection groups:

```sh
gcloud firestore fields ttls update expiresAt \
  --collection-group=googlePhotosOAuthStates \
  --enable-ttl \
  --project=project-2-pinboard-2026
gcloud firestore fields ttls update expiresAt \
  --collection-group=googlePhotosSessions \
  --enable-ttl \
  --project=project-2-pinboard-2026
```

Picker sessions are tied to the Firebase UID and creation. The API lists only items selected in that session, downloads the selected photo bytes server-side, and passes them through the same staging/finalization validator as a device upload. Temporary Google Photos `baseUrl` values and OAuth tokens are never returned to the browser or persisted as creation media. Disconnect revokes the Google token; it does not delete the user's original Google Photos item.

The bucket policies can be reapplied with:

```sh
gcloud storage buckets update gs://project-2-pinboard-2026-media \
  --cors-file=config/media-bucket-cors.json \
  --lifecycle-file=config/media-bucket-lifecycle.json \
  --public-access-prevention \
  --clear-soft-delete
gcloud firestore fields ttls update expiresAt \
  --collection-group=mediaUploadSessions \
  --enable-ttl \
  --project=project-2-pinboard-2026
```

Deploy Firestore rules and indexes with `firebase deploy --only firestore`.

## Optional demo customer API

The MongoDB customer API is disabled by default and is not required for normal startup. To enable it, set `DEMO_CUSTOMERS_ENABLED=true`, configure `MONGODB_URI`, optionally set `MONGODB_DATABASE`, and restart the API. Set the server-only `ADMIN_EMAILS` allowlist to comma-separated Firebase account emails; only allowlisted users with a verified email can read or change customer records. The API checks the verified Firebase ID token on every request; a UI route or client-supplied role is never sufficient. The customer page is shown only when the authenticated profile response confirms administrator access. Its endpoints are mounted under `/api/demo/customers` (`GET`, `POST`, `PATCH /:id`, and `DELETE /:id`). The explicit `npm run seed:demo` command inserts fictional sample records; seeding never runs during server startup.

## Project structure

- `src/config`: environment, CORS, and Firebase configuration
- `src/routes`: Firestore and optional demo route declarations
- `src/controllers`: HTTP request/response handling
- `src/services`: Firestore, media storage lifecycle, Google Photos Picker, and customer operations
- `src/middleware`: async handling, authentication, validation, not-found, and error responses
- `src/models`: MongoDB customer ID mapping and demo validation
- `src/app.js`: Express middleware and route composition
- `src/server.js`: service initialization and HTTP startup
- `src/index.js`: importable app entry point

## Development checks

- `npm test` runs the Node.js test suite.
- `npm run test:integration` starts the Firebase Authentication, Firestore, and Storage emulators and exercises authenticated creation and media flows end to end. It requires Java 21; emulator data is isolated to the `demo-project-2` project and cleaned up after the test.
- `firebase.test.json` uses permissive Storage rules solely for local emulator testing; never use that config to deploy. Production media access is restricted by the private Cloud Storage bucket's IAM policy.
- `npm run lint` runs ESLint.
- `npm run format` formats source, tests, scripts, package metadata, and this README.
- `npm run format:check` checks formatting without changes.
- `npm run check` runs lint, formatting checks, and tests.

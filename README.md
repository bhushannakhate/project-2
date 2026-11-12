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

Error codes include `VALIDATION_ERROR`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `CORS_ORIGIN_DENIED`, `UNAUTHENTICATED`, `NOT_FOUND`, `CONFLICT`, and `INTERNAL_SERVER_ERROR`.

## Firestore API

All Firestore endpoints require `Authorization: Bearer <Firebase ID token>`.

| Method   | Endpoint                                                      | Purpose                                                    |
| -------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET`    | `/api/users/me`                                               | Get or initialize the authenticated user profile.          |
| `PATCH`  | `/api/users/me`                                               | Update allowed profile fields (`displayName`, `photoURL`). |
| `GET`    | `/api/creations?limit=20&status=draft&cursor=<creationId>`    | List the user's creations.                                 |
| `GET`    | `/api/creations/:creationId`                                  | Get one owned creation.                                    |
| `POST`   | `/api/creations`                                              | Create a creation.                                         |
| `PATCH`  | `/api/creations/:creationId`                                  | Update an owned creation.                                  |
| `DELETE` | `/api/creations/:creationId`                                  | Soft-delete an owned creation.                             |
| `POST`   | `/api/creations/:creationId/media/:mediaKind/uploads`         | Start a short-lived source/output/audio upload.            |
| `POST`   | `/api/creations/:creationId/media/uploads/:uploadId/complete` | Validate and attach an uploaded file to the creation.      |
| `GET`    | `/api/creations/:creationId/media/:mediaKind/download-url`    | Get a short-lived URL for owned media.                     |

Create a creation with `instructions`, `status`, and optional JSON-object `metadata` / `pinterest` values (up to 4 KB each). Existing clients may still provide absolute HTTP(S) `sourceImageUrl`, `outputImageUrl`, or `audioUrl` values during the transition; new media must use the managed upload routes. Creation ownership and server-managed fields cannot be supplied by clients. List requests default to 20 results and accept `limit` from 1 to 100, a supported `status`, and the `nextCursor` from the previous response. Deleted creations are hidden from reads and lists.

Media lifecycle:

1. Request an upload with `mediaKind` set to `sourceImage`, `outputImage`, or `audio` and JSON `{ "contentType": "image/png", "sizeBytes": 12345 }`. Images are limited to 10 MB; audio is limited to 25 MB. The response includes a 10-minute upload URL, method, and required headers.
2. Upload the raw file bytes directly to that URL using the returned method and headers. Do not send the file to the API server.
3. Call the completion endpoint with the returned `uploadId`. The API checks actual object size and content type. Source/output images must decode as JPEG, PNG, or WebP, match the declared content type, contain one frame, and fit within 10 MiB, 10,000 pixels per side, and 40 million total pixels. Images are orientation-corrected and re-encoded to strip embedded metadata before they are stored. A creation has one current source image; a successful replacement removes the previous source object. Firestore records the private object path, content type, size, dimensions, and update time in the creation's `media` map.
4. Request a download URL for a specific media kind when needed. It expires after 5 minutes. URLs are bearer links while valid and should not be stored.
5. Deleting a creation removes its media and pending upload sessions. Failed or abandoned staged objects are automatically deleted by the bucket lifecycle rule after one day; expired Firestore upload sessions use the `expiresAt` TTL policy.

Set `MEDIA_STORAGE_BUCKET` to the dedicated private bucket name. The bucket must have public access prevention and uniform bucket-level access enabled. `config/media-bucket-cors.json` and `config/media-bucket-lifecycle.json` configure direct browser uploads and one-day staging cleanup. The Cloud Run runtime service account needs object-level bucket access and permission to sign URLs. Never make this bucket public.

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

The MongoDB customer API is disabled by default and is not required for normal startup. To enable it, set `DEMO_CUSTOMERS_ENABLED=true`, configure `MONGODB_URI`, optionally set `MONGODB_DATABASE`, and restart the API. Its endpoints are mounted under `/api/demo/customers` (`GET`, `POST`, `PATCH /:id`, and `DELETE /:id`). The explicit `npm run seed:demo` command inserts fictional sample records; seeding never runs during server startup.

## Project structure

- `src/config`: environment, CORS, and Firebase configuration
- `src/routes`: Firestore and optional demo route declarations
- `src/controllers`: HTTP request/response handling
- `src/services`: Firestore, media storage lifecycle, and customer operations
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

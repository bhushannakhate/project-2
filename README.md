# Project 2 API

[![CI](https://github.com/bhushannakhate/project-2/actions/workflows/ci.yml/badge.svg)](https://github.com/bhushannakhate/project-2/actions/workflows/ci.yml)

Maintainable Express 5 API for the Pinboard Studio application. Firebase/Firestore APIs are mounted under `/api`.

## Deployment

- **API service:** https://project-2-api-m5lsuu6ouq-uc.a.run.app
- **Project:** `project-2-pinboard-2026`
- **Region:** `us-central1`
- **UI and API (single Cloud Run image):** https://project-2-api-m5lsuu6ouq-uc.a.run.app
- **Firebase Hosting fallback:** https://project-2-pinboard-2026.web.app

See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete two-project deployment
runbook, account/configuration setup, Docker build commands, verification, and
rollback steps.

## Recent workflow implementation and validation

The current feature implementation includes the end-to-end voice workflow:

- Audio can be transcribed through `POST /api/creations/:creationId/transcription`,
  edited by the authenticated owner through the matching `PATCH` endpoint, and
  passed to the private ADK workflow as a user-approved transcript.
- The UI and API require explicit `consentToGemini: true` after the in-context
  disclosure before a Gemini workflow can run. The API also validates workflow
  instructions and keeps media, transcript, and creation ownership server-side.
- Request IDs and structured `api_5xx`/provider-failure logs are enabled for
  production troubleshooting. The observability policy and provisioning script
  are in `config/monitoring/` and `scripts/provision-observability.ps1`.

The completed checks are `npm run check` in both repositories, the ADK unit suite
(`python -m unittest discover -s agents\\tests`), the Firebase-emulator
integration test (`npm run test:integration`, with Java 21), and a successful
combined Docker image build plus Cloud Run health check. The latest verified
production revisions are `project-2-api-00026-pz5` and `pinboard-adk-00005-t2v`.

## Combined frontend and API image

The backend `Dockerfile` builds the Vite frontend from a separate named build
context, copies its static output into the Express image, and serves the UI and
`/api` on the same origin. The Vite Firebase web settings are supplied as build
arguments; they are public browser configuration, not service credentials.
`VITE_API_BASE_URL` is intentionally empty in this deployment so browser API
calls use the same Cloud Run origin. Do not pass backend or agent secrets as
Vite variables or Docker build arguments.

The private ADK service remains a **separate Cloud Run service** in the agent
owner's project because its Vertex AI runtime identity and project ownership
are separate. The combined frontend/API service calls it using Cloud Run
service-to-service authentication. One image does not combine these services
or move the agents to the backend project.

### Build and deploy the combined image (PowerShell)

Prerequisites: Docker Desktop with Buildx, access to both local source folders,
and the `partner-backend` gcloud configuration for `project-2-pinboard-2026`.
The Vite Firebase settings are taken from the frontend's ignored `.env.local`;
do not commit that file. The Firebase web API key, app ID, project ID, auth
domain, and GA measurement ID are public client settings. Never put service
account keys, OAuth client secrets, or token-encryption keys in the frontend.

```powershell
$BackendRoot = "$env:USERPROFILE\WebstormProjects\project-2mongo"
$FrontendRoot = "$env:USERPROFILE\WebstormProjects\Web-SystemPROJECT2FRONTEND\Pintrest\pintrest"
Set-Location $BackendRoot

foreach ($line in Get-Content (Join-Path $FrontendRoot ".env.local")) {
  if ($line -match '^\s*(VITE_[A-Z0-9_]+)\s*=(.*)\s*$') {
    $name = $matches[1]
    $value = $matches[2].Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item "Env:$name" $value
  }
}
$env:VITE_API_BASE_URL = ""
foreach ($name in @("VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID")) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "Required frontend build setting $name is missing from .env.local."
  }
}

$Registry = "us-central1-docker.pkg.dev"
$Repository = "cloud-run-source-deploy"
$Image = "$Registry/project-2-pinboard-2026/$Repository/pinboard-app:$(Get-Date -Format yyyyMMddHHmmss)"
```

The existing `cloud-run-source-deploy` Artifact Registry repository is used by
both the Docker CLI and the Cloud Build fallback below. Authenticate Docker and
build/push the image from the two working trees:

```powershell
$RegistryToken = gcloud.cmd --configuration=partner-backend auth print-access-token
if (-not $RegistryToken) { throw "Could not obtain an Artifact Registry access token." }
$RegistryToken | docker login --username oauth2accesstoken --password-stdin "https://$Registry"
Remove-Variable RegistryToken

docker buildx build --platform linux/amd64 --build-context frontend="$FrontendRoot" `
  --build-arg "VITE_API_BASE_URL=" `
  --build-arg "VITE_FIREBASE_API_KEY=$env:VITE_FIREBASE_API_KEY" `
  --build-arg "VITE_FIREBASE_AUTH_DOMAIN=$env:VITE_FIREBASE_AUTH_DOMAIN" `
  --build-arg "VITE_FIREBASE_PROJECT_ID=$env:VITE_FIREBASE_PROJECT_ID" `
  --build-arg "VITE_FIREBASE_APP_ID=$env:VITE_FIREBASE_APP_ID" `
  --build-arg "VITE_GA4_MEASUREMENT_ID=$env:VITE_GA4_MEASUREMENT_ID" `
  --tag $Image --push .

gcloud.cmd --configuration=partner-backend run deploy project-2-api --project=project-2-pinboard-2026 --region=us-central1 --image=$Image --quiet
```

If Docker Desktop is unavailable, submit the same Dockerfile to Cloud Build.
The frontend must be included as a named build context, but its `.env.local`
must not be copied into the upload:

```powershell
$BuildContext = Join-Path $env:TEMP "pinboard-build-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $BuildContext | Out-Null
Copy-Item Dockerfile, .dockerignore, cloudbuild.yaml, package.json, package-lock.json, src `
  -Destination $BuildContext -Recurse
$FrontendContext = Join-Path $BuildContext "frontend"
New-Item -ItemType Directory -Path $FrontendContext | Out-Null
Get-ChildItem $FrontendRoot -Force |
  Where-Object { $_.Name -notmatch '^(\.git|\.idea|node_modules|dist|dist-ssr|\.env.*|.*\.local)$' } |
  ForEach-Object { Copy-Item $_.FullName -Destination $FrontendContext -Recurse -Force }

$Image = "us-central1-docker.pkg.dev/project-2-pinboard-2026/cloud-run-source-deploy/pinboard-app:$(Get-Date -Format yyyyMMddHHmmss)"
gcloud.cmd --configuration=partner-backend builds submit $BuildContext `
  --project=project-2-pinboard-2026 --region=us-central1 --config=cloudbuild.yaml `
  --substitutions="_IMAGE=$Image,_VITE_FIREBASE_API_KEY=$env:VITE_FIREBASE_API_KEY,_VITE_FIREBASE_AUTH_DOMAIN=$env:VITE_FIREBASE_AUTH_DOMAIN,_VITE_FIREBASE_PROJECT_ID=$env:VITE_FIREBASE_PROJECT_ID,_VITE_FIREBASE_APP_ID=$env:VITE_FIREBASE_APP_ID,_VITE_GA4_MEASUREMENT_ID=$env:VITE_GA4_MEASUREMENT_ID"
gcloud.cmd --configuration=partner-backend run deploy project-2-api `
  --project=project-2-pinboard-2026 --region=us-central1 --image=$Image --quiet
Remove-Item $BuildContext -Recurse -Force
```

This deploys the frontend and API together on the existing Cloud Run service,
preserving its runtime service account and server-side settings, including
`ADK_AGENT_URL`. Verify the service and its health:

```powershell
gcloud.cmd --configuration=partner-backend run services describe project-2-api --project=project-2-pinboard-2026 --region=us-central1 --format="yaml(status.url,status.latestReadyRevisionName,status.conditions,spec.template.spec.serviceAccountName)"
curl.exe https://project-2-api-m5lsuu6ouq-uc.a.run.app/api/health
```

### Enable browser authentication and uploads on the combined origin

In [Firebase Authentication settings](https://console.firebase.google.com/project/project-2-pinboard-2026/authentication/settings),
add `project-2-api-m5lsuu6ouq-uc.a.run.app` to **Authorized domains** if it is
not already listed. Allow this origin in the API CORS configuration and the
private media bucket CORS policy. Apply the repository's bucket CORS file with
the partner account:

```powershell
gcloud.cmd --configuration=partner-backend run services update project-2-api --project=project-2-pinboard-2026 --region=us-central1 --update-env-vars="^^^^@^^^^WEB_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,https://project-1-ui-m5lsuu6ouq-uc.a.run.app,https://project-2-pinboard-2026.web.app,https://project-2-pinboard-2026.firebaseapp.com,https://project-2-api-m5lsuu6ouq-uc.a.run.app"
gcloud.cmd --configuration=partner-backend storage buckets update gs://project-2-pinboard-2026-media --cors-file=config/media-bucket-cors.json --project=project-2-pinboard-2026
```

The ADK remains deployed separately:

- [Private ADK Cloud Run service](https://console.cloud.google.com/run/detail/us-central1/pinboard-adk?project=project2adk-514723)
- [Vertex AI model usage](https://console.cloud.google.com/apis/api/aiplatform.googleapis.com/metrics?project=project2adk-514723)
- [ADK Logs Explorer](https://console.cloud.google.com/logs/query?project=project2adk-514723)

See the [agent deployment guide](agents/README.md#production-deployment-two-google-cloud-projects)
for cross-project IAM, agent deployment, authenticated invocation, verification,
and rollback details.

## Project planning

- [Pinboard Studio execution plan and rubric map](docs/Pinboard-Studio-Execution-Plan.pdf)

## Requirements and startup

Use Node.js 20 or newer. Copy `.env.example` to `.env`, configure Firebase credentials for the selected profile, then run:

```sh
npm install
npm run dev
```

Use `npm start` for normal startup. The API listens on port `4000` by default. `PORT`, `NODE_ENV`, and the comma-separated browser origins in `WEB_ORIGIN` can be customized. Requests without an `Origin` header are allowed for health probes and command-line clients. Helmet applies a Content Security Policy that allows Firebase Authentication and Google sign-in endpoints, Google Tag Manager and GA4 collection, browser-local `blob:` image previews, and the private media bucket's `storage.googleapis.com` upload/download URLs; add only specific trusted origins if these integrations change. The server also logs requests and limits JSON bodies to 20kb.

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

| Method   | Endpoint                                                                                             | Purpose                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET`    | `/api/users/me`                                                                                      | Get or initialize the authenticated user profile.                                 |
| `PATCH`  | `/api/users/me`                                                                                      | Update allowed profile fields (`displayName`, `photoURL`).                        |
| `GET`    | `/api/creations?limit=20&status=draft&search=blue&from=2026-01-01&to=2026-12-31&cursor=<creationId>` | List the user's creations with optional search, status, date, and cursor filters. |
| `GET`    | `/api/creations/:creationId`                                                                         | Get one owned creation.                                                           |
| `POST`   | `/api/creations`                                                                                     | Create a creation.                                                                |
| `PATCH`  | `/api/creations/:creationId`                                                                         | Update an owned creation.                                                         |
| `DELETE` | `/api/creations/:creationId`                                                                         | Soft-delete an owned creation.                                                    |
| `POST`   | `/api/creations/:creationId/media/:mediaKind/uploads`                                                | Start a short-lived source/output/audio upload.                                   |
| `POST`   | `/api/creations/:creationId/media/uploads/:uploadId/complete`                                        | Validate and attach an uploaded file to the creation.                             |
| `GET`    | `/api/creations/:creationId/media/:mediaKind/download-url`                                           | Get a short-lived URL for owned media.                                            |
| `POST`   | `/api/creations/:creationId/agent-workflows`                                                         | Run the private ADK workflow using the creation's uploaded image and audio.       |
| `POST`   | `/api/creations/:creationId/transcription`                                                           | Transcribe the owned uploaded audio and save the provider result.                 |
| `PATCH`  | `/api/creations/:creationId/transcription`                                                           | Save the authenticated user's edited transcription.                               |
| `GET`    | `/api/google-photos/connection`                                                                      | Get the current user's Google Photos connection status.                           |
| `POST`   | `/api/google-photos/oauth/authorize`                                                                 | Start the state- and PKCE-protected Google OAuth flow.                            |
| `GET`    | `/api/google-photos/oauth/callback`                                                                  | Google OAuth callback; protected by one-use server state.                         |
| `DELETE` | `/api/google-photos/connection`                                                                      | Revoke and remove the current user's Google Photos tokens.                        |
| `POST`   | `/api/creations/:creationId/google-photos/sessions`                                                  | Create an owner-bound Google Photos Picker session.                               |
| `GET`    | `/api/google-photos/sessions/:sessionId`                                                             | Poll the owner-bound Picker session.                                              |
| `GET`    | `/api/google-photos/sessions/:sessionId/media-items`                                                 | List selected photos without exposing temporary base URLs.                        |
| `POST`   | `/api/creations/:creationId/google-photos/sessions/:sessionId/import`                                | Import one selected photo through media validation.                               |
| `POST`   | `/api/creations/:creationId/google-photos/save`                                                      | Save an owned source or generated image to the user's Photos library.             |
| `DELETE` | `/api/google-photos/sessions/:sessionId`                                                             | Delete the Picker session and its local session record.                           |

Create a creation with `instructions`, `status`, and optional JSON-object `metadata` / `pinterest` values (up to 4 KB each). Existing clients may still provide absolute HTTP(S) `sourceImageUrl`, `outputImageUrl`, or `audioUrl` values during the transition; new media must use the managed upload routes. Creation ownership and server-managed fields cannot be supplied by clients. List requests default to 20 results and accept `limit` from 1 to 100, a supported `status`, a case-insensitive `search` term up to 100 characters, inclusive `from`/`to` dates in `YYYY-MM-DD` format, and the `nextCursor` from the previous response. Deleted creations are hidden from reads and lists.

Media lifecycle:

1. Request an upload with `mediaKind` set to `sourceImage`, `outputImage`, or `audio` and JSON `{ "contentType": "image/png", "sizeBytes": 12345 }`. Images are limited to 10 MB; audio is limited to 25 MB. The response includes a 10-minute upload URL, method, and required headers.
2. Upload the raw file bytes directly to that URL using the returned method and headers. Do not send the file to the API server.
3. Call the completion endpoint with the returned `uploadId`. The API checks actual object size and content type. Source/output images must decode as JPEG, PNG, or WebP, match the declared content type, contain one frame, and fit within 10 MiB, 10,000 pixels per side, and 40 million total pixels. Images are orientation-corrected and re-encoded to strip embedded metadata before they are stored. A creation has one current source image; a successful replacement removes the previous source object. Firestore records the private object path, content type, size, dimensions, and update time in the creation's `media` map.
4. Request a download URL for a specific media kind when needed. It expires after 5 minutes. URLs are bearer links while valid and should not be stored.
5. Deleting a creation removes its media and pending upload sessions. Failed or abandoned staged objects are automatically deleted by the bucket lifecycle rule after one day; expired Firestore upload sessions use the `expiresAt` TTL policy.

The agent workflow requires an owned creation with a validated `sourceImage` and
either written instructions, user-uploaded `audio`, or both. Audio is optional.
The browser must send `consentToGemini: true` after the in-context disclosure; a
voice workflow may also send an edited `transcript` up to 4,000 characters. IDs,
media URLs, review state, and durable writes are managed by the authenticated
Express backend. See [`agents/README.md`](agents/README.md) for local setup, Google
Cloud authentication, and private two-project deployment.

After an audio upload is completed, call `POST /api/creations/:creationId/transcription`
to produce a transcript and provider confidence value. The user can edit it with
the PATCH endpoint before starting the Gemini workflow. Audio and transcript data
remain scoped to the authenticated creation.

Set `MEDIA_STORAGE_BUCKET` to the dedicated private bucket name. The bucket must have public access prevention and uniform bucket-level access enabled. `config/media-bucket-cors.json` and `config/media-bucket-lifecycle.json` configure direct browser uploads and one-day staging cleanup. The Cloud Run runtime service account needs object-level bucket access and permission to sign URLs. Never make this bucket public.

### Google Photos setup

Enable both the Google Photos Picker API and Google Photos Library API in the canonical Google Cloud project. Configure a Google OAuth web client with the exact callback URI `https://project-2-api-m5lsuu6ouq-uc.a.run.app/api/google-photos/oauth/callback` in production and `http://localhost:4000/api/google-photos/oauth/callback` for local development. Add the corresponding frontend origins to the OAuth client and API `WEB_ORIGIN`. Use Google's current OAuth verification and test-user requirements before production use.

Set `GOOGLE_PHOTOS_CLIENT_ID`, `GOOGLE_PHOTOS_CLIENT_SECRET`, `GOOGLE_PHOTOS_REDIRECT_URI`, and `GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY` on the API. Generate a 32-byte encryption key locally with `openssl rand -base64 32`; keep the OAuth client secret and encryption key in Secret Manager for Cloud Run, never in source control or frontend configuration. Add both requested scopes to the OAuth consent screen's Data Access configuration: `photospicker.mediaitems.readonly` imports selected items, and `photoslibrary.appendonly` saves a selected or generated image only when the user requests it. Existing Picker-only connections are asked to grant the save scope the first time they save. Tokens are AES-256-GCM encrypted in server-only Firestore documents. Replacing the encryption key without re-encrypting existing documents makes existing connections unreadable.

The production project `project-2-pinboard-2026` has Identity Toolkit, Firestore, Cloud Storage, Photos Picker, Photos Library, Secret Manager, and Cloud Run APIs enabled. Its `project-2-api` service reads the OAuth client secret and token-encryption key from Secret Manager secrets `pinboard-google-photos-client-secret` and `pinboard-google-photos-token-encryption-key`; grant `roles/secretmanager.secretAccessor` to the Cloud Run runtime service account when rotating or replacing those secrets. The OAuth client ID is configured as a non-secret Cloud Run environment variable, and the callback is set to the production URI above. The callback was verified with Google's OAuth authorization endpoint. The OAuth consent screen must still have the requested scopes configured and the signed-in user must satisfy the app's publishing/test-user requirements.

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

## Project structure

- `src/config`: environment, CORS, and Firebase configuration
- `src/routes`: Firestore and application route declarations
- `src/controllers`: HTTP request/response handling
- `src/services`: Firestore, media storage lifecycle, and Google Photos Picker
- `src/middleware`: async handling, authentication, validation, not-found, and error responses
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

The private Python Google ADK service, local PowerShell/Bash setup, and two-project
Cloud Run deployment/IAM instructions are documented in [`agents/README.md`](agents/README.md).

GA4 Measurement Protocol events and structured ADK request logs are configured
in the Express API. See [`docs/analytics-and-logging.md`](docs/analytics-and-logging.md)
for GA4 setup, the separate React UI integration, Cloud Logging permissions,
and report metric guidance.

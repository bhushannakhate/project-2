# Deployment runbook

This runbook records the production topology and deployment work completed on
2026-11-24, and gives repeatable steps for frontend, backend, and ADK agent code
changes. Commands use PowerShell and Windows paths.

## Security and project access

The project IDs, service names, URLs, service-account identities, and Secret
Manager secret names below identify resources; they are not login credentials.
This document intentionally does **not** contain passwords, access tokens,
service-account private keys, Firebase OAuth secrets, or encryption-key values.
Each owner signs in to Google Cloud CLI on their own computer with
`gcloud.cmd auth login`. Never send credentials or secret values to a partner or
put them in source control, frontend configuration, Docker build arguments, or
this document.

| Purpose                           | gcloud configuration | Google Cloud project      | Region        | Runtime service account                                                |
| --------------------------------- | -------------------- | ------------------------- | ------------- | ---------------------------------------------------------------------- |
| Combined frontend and Express API | `partner-backend`    | `project-2-pinboard-2026` | `us-central1` | `pinboard-api-runtime@project-2-pinboard-2026.iam.gserviceaccount.com` |
| Private ADK agent service         | `adk-owner`          | `project2adk-514723`      | `us-central1` | `pinboard-adk-runtime@project2adk-514723.iam.gserviceaccount.com`      |

Use the named configuration on every command so the wrong project is not
deployed to:

```powershell
gcloud.cmd config configurations list
gcloud.cmd --configuration=partner-backend config set project project-2-pinboard-2026
gcloud.cmd --configuration=adk-owner config set project project2adk-514723
gcloud.cmd --configuration=partner-backend auth list
gcloud.cmd --configuration=adk-owner auth list
```

The `partner-backend` identity needs deployment permissions in
`project-2-pinboard-2026`; the `adk-owner` identity needs deployment permissions
in `project2adk-514723`. Do not exchange account passwords or service-account
keys. The backend runtime service account is the only Cloud Run invoker allowed
on the private ADK service.

## Production resources

| Resource                          | Current value                                                                | Console                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Combined app URL                  | `https://project-2-api-m5lsuu6ouq-uc.a.run.app`                              | [Cloud Run service](https://console.cloud.google.com/run/detail/us-central1/project-2-api?project=project-2-pinboard-2026) |
| Combined app ready revision       | `project-2-api-00023-nd6`                                                    | Same service page                                                                                                          |
| Backend image repository          | `us-central1-docker.pkg.dev/project-2-pinboard-2026/cloud-run-source-deploy` | [Artifact Registry](https://console.cloud.google.com/artifacts?project=project-2-pinboard-2026)                            |
| Firebase project and media bucket | `project-2-pinboard-2026`; `project-2-pinboard-2026-media`                   | [Firebase console](https://console.firebase.google.com/project/project-2-pinboard-2026/overview)                           |
| Private ADK URL                   | `https://pinboard-adk-adiuzklbmq-uc.a.run.app`                               | [Cloud Run service](https://console.cloud.google.com/run/detail/us-central1/pinboard-adk?project=project2adk-514723)       |
| ADK ready revision                | `pinboard-adk-00003-2tt`                                                     | Same service page                                                                                                          |
| ADK image repository              | `us-central1-docker.pkg.dev/project2adk-514723/cloud-run-source-deploy`      | [Artifact Registry](https://console.cloud.google.com/artifacts?project=project2adk-514723)                                 |
| ADK model project                 | `project2adk-514723`, Vertex AI location `global`                            | [Vertex AI](https://console.cloud.google.com/vertex-ai?project=project2adk-514723)                                         |

The frontend and Express API are built into **one image and one Cloud Run
service**. The Python ADK agent remains a separate, private Cloud Run service
in its owner project. The backend calls it using a Google-signed ID token; the
agent uses its own runtime service account for Vertex AI.

## What was completed on 2026-11-24

- Built and deployed the combined frontend/API Docker image. Cloud Run serves
  the SPA and `/api` from the same origin.
- Updated the Helmet Content Security Policy for Firebase Authentication,
  Google sign-in, Google Analytics, browser `blob:` image previews, and signed
  Cloud Storage media URLs.
- Configured Google Photos OAuth on the backend. The OAuth client secret and
  media-token encryption key are stored in Secret Manager as
  `pinboard-google-photos-client-secret` and
  `pinboard-google-photos-token-encryption-key`. The production callback is
  `https://project-2-api-m5lsuu6ouq-uc.a.run.app/api/google-photos/oauth/callback`.
- Enabled the required Firebase, Storage, Photos Picker, Photos Library,
  Secret Manager, Cloud Run, and Vertex AI APIs in their respective projects.
- Deployed the updated ADK code as `pinboard-adk-00003-2tt`. The prior agent
  revision required audio input and rejected text-only workflows with HTTP 422;
  the current code accepts text-only requests.
- Confirmed the services are ready, the API health check responds, and the
  backend runtime identity retains access to the private ADK service.

## Prerequisites and source paths

Install/start Docker Desktop with Buildx and install the Google Cloud CLI. Make
sure both repositories are available locally:

```powershell
$BackendRoot = "$env:USERPROFILE\WebstormProjects\project-2mongo"
$FrontendRoot = "$env:USERPROFILE\WebstormProjects\Web-SystemPROJECT2FRONTEND\Pintrest\pintrest"
```

The backend repo contains the `Dockerfile`, API code, `agents` directory,
`cloudbuild.yaml`, and backend deployment documentation. The frontend is a
separate repo at `$FrontendRoot`. The frontend `.env.local` must contain the
public Vite settings `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`. `VITE_GA4_MEASUREMENT_ID`
is optional. Keep `.env.local` out of git; use an empty
`VITE_API_BASE_URL` for the same-origin production app.

Load those Vite settings into the current PowerShell session without printing
or committing them:

```powershell
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
```

Firebase web settings are client configuration and become part of the browser
bundle; they are not server credentials. Never pass an OAuth client secret,
Google service-account key, or `GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY` to Vite.

## Deploy frontend and backend changes

Any frontend or Express API code change requires rebuilding and deploying the
combined image. A change to either repository is included from its respective
working tree. Run these commands from the backend repository root:

```powershell
Set-Location $BackendRoot
$Registry = "us-central1-docker.pkg.dev"
$Image = "$Registry/project-2-pinboard-2026/cloud-run-source-deploy/pinboard-app:$(Get-Date -Format yyyyMMddHHmmss)"

$RegistryToken = gcloud.cmd --configuration=partner-backend auth print-access-token
if (-not $RegistryToken) { throw "Could not obtain an Artifact Registry access token." }
$RegistryToken | docker login --username oauth2accesstoken --password-stdin "https://$Registry"
if ($LASTEXITCODE -ne 0) { throw "Artifact Registry login failed." }
Remove-Variable RegistryToken

docker buildx build --platform linux/amd64 --build-context frontend="$FrontendRoot" `
  --build-arg "VITE_API_BASE_URL=" `
  --build-arg "VITE_FIREBASE_API_KEY=$env:VITE_FIREBASE_API_KEY" `
  --build-arg "VITE_FIREBASE_AUTH_DOMAIN=$env:VITE_FIREBASE_AUTH_DOMAIN" `
  --build-arg "VITE_FIREBASE_PROJECT_ID=$env:VITE_FIREBASE_PROJECT_ID" `
  --build-arg "VITE_FIREBASE_APP_ID=$env:VITE_FIREBASE_APP_ID" `
  --build-arg "VITE_GA4_MEASUREMENT_ID=$env:VITE_GA4_MEASUREMENT_ID" `
  --tag $Image --push .
if ($LASTEXITCODE -ne 0) { throw "Image build or push failed; do not deploy." }

gcloud.cmd --configuration=partner-backend run deploy project-2-api `
  --project=project-2-pinboard-2026 --region=us-central1 --image=$Image --quiet
if ($LASTEXITCODE -ne 0) { throw "Cloud Run deployment failed." }
```

Deploying the image without environment overrides preserves the existing
backend runtime service account and settings such as Firebase, `WEB_ORIGIN`,
Secret Manager bindings, and `ADK_AGENT_URL`. If changing a service setting is
intentional, inspect the current service configuration first; prefer
`--update-env-vars` to preserve unrelated variables. Never use `--set-env-vars`
unless intentionally replacing the complete environment.

If Docker Desktop is unavailable, the backend `README.md` documents the
Cloud Build fallback using `cloudbuild.yaml`.

## Deploy ADK agent changes

Only rebuild/redeploy the separate ADK service when code under `agents` changes.
Run from the agents directory with the `adk-owner` account. `agents/.dockerignore`
excludes local environment files, virtual environments, credentials, and Python
caches from the build context.

```powershell
$AgentRoot = Join-Path $BackendRoot "agents"
$Registry = "us-central1-docker.pkg.dev"
$Image = "$Registry/project2adk-514723/cloud-run-source-deploy/pinboard-adk:$(Get-Date -Format yyyyMMddHHmmss)"

$RegistryToken = gcloud.cmd --configuration=adk-owner auth print-access-token
if (-not $RegistryToken) { throw "Could not obtain the ADK Artifact Registry access token." }
$RegistryToken | docker login --username oauth2accesstoken --password-stdin "https://$Registry"
if ($LASTEXITCODE -ne 0) { throw "ADK Artifact Registry login failed." }
Remove-Variable RegistryToken

Set-Location $AgentRoot
docker buildx build --platform linux/amd64 --tag $Image --push .
if ($LASTEXITCODE -ne 0) { throw "ADK image build or push failed; do not deploy." }

gcloud.cmd --configuration=adk-owner run deploy pinboard-adk `
  --project=project2adk-514723 --region=us-central1 --image=$Image --quiet
if ($LASTEXITCODE -ne 0) { throw "ADK Cloud Run deployment failed." }
```

The image-only deployment preserves the private service's runtime service
account, environment, audience, and caller allowlist. In particular, keep
`ADK_EXPECTED_AUDIENCE=https://pinboard-adk-adiuzklbmq-uc.a.run.app` and
`ADK_EXPECTED_CALLER_SERVICE_ACCOUNT=pinboard-api-runtime@project-2-pinboard-2026.iam.gserviceaccount.com`.
Do not add `--allow-unauthenticated`.

If the ADK service settings themselves must be changed, inspect them first and
use `--update-env-vars`, not `--set-env-vars`; replacing its full environment
can remove the private caller settings and break backend-to-agent calls.

## Google Photos and Firebase configuration

The backend uses Secret Manager references:

| Cloud Run setting                    | Secret Manager secret                         |
| ------------------------------------ | --------------------------------------------- |
| `GOOGLE_PHOTOS_CLIENT_SECRET`        | `pinboard-google-photos-client-secret`        |
| `GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY` | `pinboard-google-photos-token-encryption-key` |

The backend runtime service account needs `roles/secretmanager.secretAccessor`
on those secrets. Do not print secret versions' values or replace the
encryption key casually: existing encrypted Google Photos connections will no
longer decrypt if that key changes.

For OAuth changes, configure the OAuth web client with this exact production
redirect URI:

```text
https://project-2-api-m5lsuu6ouq-uc.a.run.app/api/google-photos/oauth/callback
```

Keep the OAuth client ID and redirect URI in backend Cloud Run configuration;
keep the client secret and encryption key in Secret Manager. The consent
screen needs the app's requested Google Photos scopes and the intended user
must meet Google's testing/publishing requirements. Firebase Authentication
must list `project-2-api-m5lsuu6ouq-uc.a.run.app` as an authorized domain.

Required APIs checked for this deployment:

- Backend/Firebase project `project-2-pinboard-2026`: Identity Toolkit,
  Firestore, Firebase Rules, Cloud Storage, Photos Picker, Photos Library,
  Secret Manager, and Cloud Run.
- Agent project `project2adk-514723`: Vertex AI (`aiplatform.googleapis.com`),
  Cloud Run, Cloud Build, and Artifact Registry.

The media bucket's `config/media-bucket-cors.json` must continue to allow the
combined app origin and signed `PUT` uploads. To reapply it:

```powershell
Set-Location $BackendRoot
gcloud.cmd --configuration=partner-backend storage buckets update `
  gs://project-2-pinboard-2026-media --cors-file=config/media-bucket-cors.json `
  --project=project-2-pinboard-2026
```

The API Content Security Policy in `src/app.js` must continue to allow
Firebase/Google Auth and Analytics, `blob:` previews, and
`https://storage.googleapis.com` for signed image uploads/downloads. Add only
specific trusted origins if an integration changes.

## Observability provisioning

The API emits a UUID request ID on every response and writes structured
`api_5xx`, `external_api_call`, `google_photos_upload_rejected`, and
`gemini_api_call` events without tokens, prompts, media bytes, or temporary
Google Photos URLs. Provision the Cloud Logging metrics and alert policy after
the first deployment, using the named backend configuration:

```powershell
Set-Location $BackendRoot
.\scripts\provision-observability.ps1
```

The script is idempotent: existing metrics and the alert policy are preserved.
The alert has no notification channel by default, so add the team's approved
email or PagerDuty channel in Cloud Monitoring after reviewing access.

## Verify after every deployment

### Combined frontend/API

```powershell
$AppUrl = "https://project-2-api-m5lsuu6ouq-uc.a.run.app"
Invoke-RestMethod "$AppUrl/api/health"
Invoke-WebRequest $AppUrl -UseBasicParsing
gcloud.cmd --configuration=partner-backend run services describe project-2-api `
  --project=project-2-pinboard-2026 --region=us-central1 `
  --format="yaml(status.url,status.latestReadyRevisionName,status.conditions,status.traffic,spec.template.spec.serviceAccountName)"
```

In the browser, verify Firebase sign-in, a device image upload, a Google Photos
import, an agent workflow using that image, and the resulting image preview.
The signed-in browser request to
`/api/google-photos/connection` should return a connection status, not
`GOOGLE_PHOTOS_NOT_CONFIGURED`.

### ADK service

Do not use an unauthenticated browser request to the ADK URL as a health check:
the service is intentionally private. Verify its readiness and caller policy:

```powershell
gcloud.cmd --configuration=adk-owner run services describe pinboard-adk `
  --project=project2adk-514723 --region=us-central1 `
  --format="yaml(status.url,status.latestReadyRevisionName,status.conditions,status.traffic,spec.template.spec.serviceAccountName)"
gcloud.cmd --configuration=adk-owner run services get-iam-policy pinboard-adk `
  --project=project2adk-514723 --region=us-central1
```

Then verify an authenticated end-to-end workflow through the frontend/API.
Check logs for the two services if it fails:

```powershell
gcloud.cmd --configuration=partner-backend logging read `
  'resource.type="cloud_run_revision" AND resource.labels.service_name="project-2-api"' `
  --project=project-2-pinboard-2026 --freshness=30m --limit=50 --order=desc
gcloud.cmd --configuration=adk-owner logging read `
  'resource.type="cloud_run_revision" AND resource.labels.service_name="pinboard-adk"' `
  --project=project2adk-514723 --freshness=30m --limit=50 --order=desc
```

## Roll back

Each successful deployment creates a new revision. If verification fails,
identify the last known-good revision in the service's revision list, then
send all traffic back to it:

```powershell
gcloud.cmd --configuration=partner-backend run services update-traffic project-2-api `
  --project=project-2-pinboard-2026 --region=us-central1 `
  --to-revisions=project-2-api-00023-nd6=100

gcloud.cmd --configuration=adk-owner run services update-traffic pinboard-adk `
  --project=project2adk-514723 --region=us-central1 `
  --to-revisions=pinboard-adk-00003-2tt=100
```

Replace the example revision with the actual prior healthy revision if the
current known-good revision has changed. Roll back backend and agent
independently; they are separate services and projects.

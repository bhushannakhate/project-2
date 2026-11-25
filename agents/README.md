# Pinboard Studio ADK service

This Python 3.11+ service runs the five-agent image workflow and is invoked only by
the authenticated Express API. Express verifies the Firebase ID token, checks
creation ownership, creates a short-lived signed URL for that creation's validated
source image and, when selected, a signed URL for its uploaded audio, then sends
those URLs to the private ADK service.
ADK validates the object paths against the supplied user and creation IDs, reads
the media, and returns a reviewed image. Express validates and saves that image
through the existing Cloud Storage upload-completion and Firestore update flow.
The browser never calls ADK, supplies a user ID, object path, signed URL, or review
approval. Google Photos OAuth remains in Express; export is not part of this
workflow and would require a separate user action.

The Python service uses Vertex AI Gemini through Application Default Credentials.
It does not receive Firebase credentials, Google Photos tokens, or direct Firestore
or Cloud Storage IAM access. The signed URLs are read-only, scoped to one object,
expire after 15 minutes, and must never be logged or sent to the frontend. A
workflow accepts typed instructions, uploaded audio, or both; only the source
image is always required.

## Workflow contracts

Express calls this private service for two operations: `/transcriptions` reads an
owner-bound signed audio URL and returns a transcript with provider confidence,
and `/workflows` runs the image workflow. The browser never calls either ADK
route. Express enforces the user's Gemini disclosure consent and may pass an
authenticated user's edited `audio_transcript` to `/workflows` (maximum 4,000
characters), so the workflow does not have to re-transcribe an edited voice note.
Neither route accepts Firebase credentials, Google Photos tokens, arbitrary object
paths, or caller-supplied user IDs.

## Validation

Run the ADK regression suite from the backend repository root with:

```powershell
python -m unittest discover -s agents\tests
```

The Express/Firebase emulator integration suite is run separately with
`npm run test:integration` and Java 21. The frontend uses `npm run check`, which
runs ESLint, Vitest, and the Vite production build. These checks, the combined
Docker image build, and a production `/api/health` request were verified for the
current implementation.

## Files

| File                                     | Purpose                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                             | Builds the Python 3.12 Cloud Run container and starts Uvicorn.                                                                     |
| `requirements.txt`                       | Pins the ADK, FastAPI/Uvicorn, Google Auth/GenAI, Cloud Logging, and HTTP client dependencies.                                     |
| `server.py`                              | FastAPI endpoint, Cloud Run caller-token verification, one-invocation runner, and in-memory session lifecycle.                     |
| `pinboard_agents/.env.example`           | Local non-secret defaults and placeholders for the ADK project and teammate's media bucket.                                        |
| `pinboard_agents/.env`                   | Ignored, local-only configuration loaded when the agent package starts.                                                            |
| `pinboard_agents/credentials/`           | Reserved folder; intentionally contains no credential files. Use ADC locally and an attached runtime service account on Cloud Run. |
| `pinboard_agents/agent.py`               | The Creative Coordinator, Image Retrieval, Audio Processing, Review, and Publishing agents and their ordered workflow.             |
| `pinboard_agents/tools/media_tools.py`   | Restricts and reads signed media URLs, then transcribes the user's uploaded audio.                                                 |
| `pinboard_agents/tools/gemini_tools.py`  | Analyzes the imported photo, edits it with Gemini, enforces one review revision, and prepares the result for Express.              |
| `pinboard_agents/tools/model_logging.py` | Writes structured success/failure and duration records for every Vertex AI Gemini request to Cloud Logging.                        |
| `pinboard_agents/__init__.py`            | Exposes the ADK `root_agent` to the ADK development UI.                                                                            |
| `tests/test_session_isolation.py`        | Checks separation for two user IDs and two creation IDs.                                                                           |
| `tests/test_media_url_scope.py`          | Verifies signed media URLs cannot cross user or creation boundaries.                                                               |
| `tests/test_workflow_inputs.py`          | Verifies text-only, audio-only, combined-input, and empty-input request validation.                                                |

## Local setup and run

Open the backend repository root in each terminal. These commands create the
package directories and missing initializers without replacing existing source
files.

### PowerShell

```powershell
New-Item -ItemType Directory -Force -Path agents\pinboard_agents\tools, agents\tests | Out-Null
$initializers = @("agents\pinboard_agents\__init__.py", "agents\pinboard_agents\tools\__init__.py", "agents\pinboard_agents\credentials\.gitkeep")
foreach ($file in $initializers) {
    if (-not (Test-Path $file)) { New-Item -ItemType File -Path $file | Out-Null }
}
if (-not (Test-Path "agents\pinboard_agents\.env")) {
    Copy-Item agents\pinboard_agents\.env.example agents\pinboard_agents\.env
}
py -3.11 -m venv agents\.venv
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\agents\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r agents\requirements.txt
python -c "from importlib.metadata import version; from google.adk.agents import Agent, SequentialAgent; print('google-adk', version('google-adk'))"
adk --help
gcloud auth application-default login
gcloud config set project <ADK_PROJECT_ID>
gcloud auth application-default set-quota-project <ADK_PROJECT_ID>
```

The checked-in example contains the provided ADK project and media bucket IDs.
Copy it if needed and confirm the values in `agents\pinboard_agents\.env`.
The other settings are concrete defaults and may be changed if those models
are not available to your project/region. The package loads this file for local
ADK commands; environment variables already set by Cloud Run take precedence.
Authenticate with ADC as shown above. Do not copy service-account JSON keys into
the `credentials` folder.

In terminal 1, start the loopback-only ADK development UI:

```powershell
adk web agents --host 127.0.0.1 --port 8001 --session_service_uri memory:// --artifact_service_uri memory://
```

In terminal 2, start the private workflow endpoint on loopback:

```powershell
python -m uvicorn server:app --app-dir agents --host 127.0.0.1 --port 8000 --reload
```

### Bash

```bash
mkdir -p agents/pinboard_agents/tools agents/tests
for file in agents/pinboard_agents/__init__.py agents/pinboard_agents/tools/__init__.py agents/pinboard_agents/credentials/.gitkeep; do
  test -e "$file" || : > "$file"
done
if [ ! -f agents/pinboard_agents/.env ]; then
  cp agents/pinboard_agents/.env.example agents/pinboard_agents/.env
fi
python3.11 -m venv agents/.venv
source agents/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r agents/requirements.txt
python -c "from importlib.metadata import version; from google.adk.agents import Agent, SequentialAgent; print('google-adk', version('google-adk'))"
adk --help
gcloud auth application-default login
gcloud config set project <ADK_PROJECT_ID>
gcloud auth application-default set-quota-project <ADK_PROJECT_ID>
```

The checked-in example contains the provided ADK project and media bucket IDs.
Copy it if needed and confirm the values in `agents/pinboard_agents/.env`.
The other settings are concrete defaults and may be changed if those models
are not available to your project/region. The package loads this file for local
ADK commands; environment variables already set by Cloud Run take precedence.
Authenticate with ADC as shown above. Do not copy service-account JSON keys into
the `credentials` folder.

In terminal 1, start the loopback-only ADK development UI:

```bash
adk web agents --host 127.0.0.1 --port 8001 --session_service_uri memory:// --artifact_service_uri memory://
```

In terminal 2, start the private workflow endpoint on loopback:

```bash
python -m uvicorn server:app --app-dir agents --host 127.0.0.1 --port 8000 --reload
```

The backend's root `.env` must keep `ADK_AGENT_URL=http://127.0.0.1:8000`.
The Express application uses its existing server-side Firebase configuration and
must be started from the backend root with `npm run dev`. Start the separately
hosted frontend last, using that repository's existing development command; the
frontend must continue to call Express, never the ADK URL. Use Python's test runner
for the session isolation check after activating the virtual environment:

```powershell
python -m unittest discover -s agents\tests
```

```bash
python -m unittest discover -s agents/tests
```

Local development needs an enabled Vertex AI API and an ADC identity allowed to
invoke Gemini in the ADK project. The backend still needs its existing Firebase
credentials and access to its Firebase, Firestore, and media bucket.
The ADK runtime service account also needs `roles/logging.logWriter` in the ADK
project for Gemini request records. In Logs Explorer for that project, filter
on `jsonPayload.event="gemini_api_call"`; records include model, workflow stage,
outcome, duration, and request ID, but never prompts or media.

If Express returns `AGENT_CAPACITY_LIMITED`, ADK received a Vertex AI
`RESOURCE_EXHAUSTED` response. Wait before retrying and inspect Vertex AI quota
and rate-limit metrics for the configured project, model, and location. The
five-agent workflow makes multiple model requests, so a successful one-shot
Gemini probe does not guarantee that the full workflow fits current capacity.

## Session isolation and limits

The API creates a fresh `InMemorySessionService` session for each invocation.
ADK's session `user_id` is set from Express's verified Firebase UID, and the
session state also binds the current creation ID and a backend-generated
workflow/session UUID. The workflow completes in one request, and the session is
deleted afterward; retries rebuild state from the creation and media URLs that
Express reauthorizes. No durable user, creation, media, or workflow record depends
on session memory.

In-memory sessions are temporary, are not shared across Cloud Run instances, and
are lost when an instance restarts. Do not use the ADK development UI in
production. Cloud Run's IAM gate and the service's Google-signed ID-token
verification restrict production requests to the configured Express service
account and exact service URL audience.

Run the Firebase-emulator integration test with two distinct authenticated users
and creations: upload a validated source image and audio to each user's own
creation, then invoke the workflow through Express for both. The included unit
tests use two distinct user IDs and creation IDs to verify ADK session and
media-URL separation. The Express integration test separately proves another
user's creation returns 404. Never pass user IDs, media paths, or approval
decisions from a browser.

## Production deployment: two Google Cloud projects

The workflow has three separate parts:

1. The frontend calls the Express API; it never calls ADK directly.
2. Express checks Firebase authentication and creation ownership, then calls the
   private ADK service with a Google-signed identity token.
3. ADK calls Vertex AI Gemini using its Cloud Run runtime identity, reads only
   the signed source/audio URLs provided by Express, and returns the result.
   Express stores the output in its own media bucket and Firestore.

The ADK service is **Cloud Run**, not a Vertex AI Agent Engine deployment.
Vertex AI is the model API used by the agents. API activity in Vertex AI does not
mean that an Agent Engine resource exists.

### Verified deployment and console links

These are the observed resource values; confirm them in the consoles before
changing IAM or deploying. The partner should run commands against the backend
project using an account that has permission there. Do not exchange passwords,
service-account keys, ID tokens, or secret values.

| Resource                        | Project / region                         | Link or value                                                                                                                   |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Agent Cloud Run service         | `project2adk-514723`, `us-central1`      | [pinboard-adk service](https://console.cloud.google.com/run/detail/us-central1/pinboard-adk?project=project2adk-514723)         |
| Agent service URL               | `project2adk-514723`                     | `https://pinboard-adk-adiuzklbmq-uc.a.run.app`                                                                                  |
| Agent runtime service account   | `project2adk-514723`                     | `pinboard-adk-runtime@project2adk-514723.iam.gserviceaccount.com`                                                               |
| Agent ready revision            | `project2adk-514723`, `us-central1`      | `pinboard-adk-00003-2tt`                                                                                                        |
| Agent project Vertex AI         | `project2adk-514723`                     | [Vertex AI](https://console.cloud.google.com/vertex-ai?project=project2adk-514723)                                              |
| Agent project API usage         | `project2adk-514723`                     | [Vertex AI API metrics](https://console.cloud.google.com/apis/api/aiplatform.googleapis.com/metrics?project=project2adk-514723) |
| Agent project build history     | `project2adk-514723`, `us-central1`      | [Cloud Build history](https://console.cloud.google.com/cloud-build/builds?project=project2adk-514723)                           |
| Agent project logs              | `project2adk-514723`                     | [Logs Explorer](https://console.cloud.google.com/logs/query?project=project2adk-514723)                                         |
| Backend Cloud Run API           | `project-2-pinboard-2026`, `us-central1` | [project-2-api service](https://console.cloud.google.com/run/detail/us-central1/project-2-api?project=project-2-pinboard-2026)  |
| Backend runtime service account | `project-2-pinboard-2026`                | `pinboard-api-runtime@project-2-pinboard-2026.iam.gserviceaccount.com`                                                          |
| Backend ready revision          | `project-2-pinboard-2026`, `us-central1` | `project-2-api-00023-nd6`                                                                                                       |
| Backend Firebase project        | `project-2-pinboard-2026`                | [Firebase console](https://console.firebase.google.com/project/project-2-pinboard-2026/overview)                                |
| Frontend Firebase Hosting       | `project-2-pinboard-2026`                | [Hosting console](https://console.firebase.google.com/project/project-2-pinboard-2026/hosting/sites)                            |

Verified 2026-11-24: the agent service is ready on revision
`pinboard-adk-00003-2tt`, configured for `global` Vertex AI location and the
models in `pinboard_agents/.env.example`. Its runtime account has
`roles/aiplatform.user` and `roles/logging.logWriter`. The service is private;
its only Cloud Run invoker is
the backend runtime service account listed above, which is also the only caller
allowed by the application's ID-token check. `ADK_EXPECTED_AUDIENCE` is set to
the agent URL and the backend Cloud Run service has `ADK_AGENT_URL` set to that
same URL. The backend is ready on revision `project-2-api-00023-nd6`, and
`/api/health` returned HTTP 200 after configuration. Do not treat an
unauthenticated browser/curl request to the agent's `/healthz` as a health
check: Cloud Run IAM blocks it before the app endpoint is reached.

The previous agent revision predated the optional-audio workflow input change
and rejected text-only requests with HTTP 422. Revision `pinboard-adk-00003-2tt`
contains that fix. For code-only redeploys, build and push the agent Docker
image, then deploy with `--image` and no environment/IAM overrides so the
private caller configuration remains intact.

### 1. Confirm both project owners and runtime identities

The agent owner performs steps 1–3 in `project2adk-514723`. The backend owner
performs step 4 in `project-2-pinboard-2026`. Each owner signs in locally; do
not send credentials to the other owner.

Use separate named gcloud configurations so commands in the two projects do
not accidentally use the other account. Configuration names are local to the
computer; create them once. Substitute each owner's Google account email:

```powershell
gcloud.cmd config configurations list
gcloud.cmd config configurations create partner-backend --activate
gcloud.cmd auth login <BACKEND_OWNER_EMAIL>
gcloud.cmd config set account <BACKEND_OWNER_EMAIL>
gcloud.cmd config set project project-2-pinboard-2026
gcloud.cmd config configurations create adk-owner --activate
gcloud.cmd auth login <ADK_OWNER_EMAIL>
gcloud.cmd config set account <ADK_OWNER_EMAIL>
gcloud.cmd config set project project2adk-514723
```

If a named configuration already exists, do not create it again. Activate it
with `gcloud.cmd config configurations activate <CONFIG_NAME>` and set its
account and project. Use `--configuration=adk-owner` on every agent-project
command and `--configuration=partner-backend` on every backend-project
command, even when running them in separate terminal tabs. For example:

```powershell
gcloud.cmd --configuration=adk-owner projects describe project2adk-514723
gcloud.cmd --configuration=partner-backend projects describe project-2-pinboard-2026
```

Confirm the agent project and existing service:

```powershell
gcloud.cmd --configuration=adk-owner run services describe pinboard-adk --project=project2adk-514723 --region=us-central1
```

Confirm the agent service account has Vertex AI access:

```powershell
gcloud.cmd --configuration=adk-owner projects get-iam-policy project2adk-514723 --flatten="bindings[].members" --filter="bindings.members:pinboard-adk-runtime@project2adk-514723.iam.gserviceaccount.com" --format="table(bindings.role)"
```

It needs `roles/aiplatform.user` for Gemini and `roles/logging.logWriter` for
agent model-call logs. If logging is not already granted, the agent project
owner can grant it:

```powershell
gcloud.cmd --configuration=adk-owner projects add-iam-policy-binding project2adk-514723 --member="serviceAccount:pinboard-adk-runtime@project2adk-514723.iam.gserviceaccount.com" --role="roles/logging.logWriter"
```

The backend owner obtains the Express service's runtime identity and gives the
email address (not a key) to the agent owner:

```powershell
gcloud.cmd --configuration=partner-backend run services describe project-2-api --project=project-2-pinboard-2026 --region=us-central1 --format="value(spec.template.spec.serviceAccountName)"
```

If that command reports the project or service is unavailable, confirm the
backend owner is signed into the correct Google account and that
`project-2-api` is in `us-central1`. Do not guess the runtime service account.

### 2. Deploy or update the private agent service

Run from the backend repository root (`$env:USERPROFILE\WebstormProjects\project-2mongo`)
using the agent-project owner account. `--source agents` builds the tracked
`agents\Dockerfile`; it does not deploy `.venv` or the local `.env`. The existing
service name, project, region, account, model IDs, and media bucket are supplied
below. This creates a new Cloud Run revision and leaves the previous revision
available for rollback.

First confirm required APIs and runtime identity:

```powershell
gcloud.cmd --configuration=adk-owner services enable run.googleapis.com aiplatform.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=project2adk-514723
gcloud.cmd --configuration=adk-owner iam service-accounts describe pinboard-adk-runtime@project2adk-514723.iam.gserviceaccount.com --project=project2adk-514723
```

Deploy privately; do **not** add `--allow-unauthenticated`:

```powershell
cd "$env:USERPROFILE\WebstormProjects\project-2mongo"
gcloud.cmd --configuration=adk-owner run deploy pinboard-adk --source agents --project=project2adk-514723 --region=us-central1 --service-account=pinboard-adk-runtime@project2adk-514723.iam.gserviceaccount.com --no-allow-unauthenticated --concurrency=2 --memory=1Gi --timeout=900 --max=3 --update-env-vars="NODE_ENV=production,GOOGLE_CLOUD_PROJECT=project2adk-514723,GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=TRUE,GEMINI_TEXT_MODEL=gemini-3.5-flash,GEMINI_IMAGE_MODEL=gemini-3.1-flash-image,MEDIA_STORAGE_BUCKET=project-2-pinboard-2026-media"
```

Use `--update-env-vars`, not `--set-env-vars`, when updating existing service
settings: replacing the full environment can remove
`ADK_EXPECTED_AUDIENCE` and `ADK_EXPECTED_CALLER_SERVICE_ACCOUNT`, breaking
authenticated backend calls.

If Cloud Run reports that the deployer cannot act as the runtime identity, the
agent project owner must grant the deployer `roles/iam.serviceAccountUser` on
the named runtime service account. Use the actual model IDs supported and
enabled for the agent project; check [Vertex AI Model Garden](https://console.cloud.google.com/vertex-ai/model-garden?project=project2adk-514723)
and [Vertex AI quotas](https://console.cloud.google.com/iam-admin/quotas?project=project2adk-514723).

### 3. Allow only the partner's backend service to invoke ADK

Set the PowerShell variable to the runtime service-account email the partner
retrieved in step 1. The following updates the agent application's caller
allowlist and grants Cloud Run invocation on this service only:

```powershell
$BackendCaller = "<BACKEND_RUNTIME_SERVICE_ACCOUNT_EMAIL>"
$AdkUrl = gcloud.cmd --configuration=adk-owner run services describe pinboard-adk --project=project2adk-514723 --region=us-central1 --format="value(status.url)"
if (-not $AdkUrl) { throw "Could not read the deployed ADK Cloud Run URL." }
gcloud.cmd --configuration=adk-owner run services update pinboard-adk --project=project2adk-514723 --region=us-central1 --update-env-vars="ADK_EXPECTED_AUDIENCE=$AdkUrl,ADK_EXPECTED_CALLER_SERVICE_ACCOUNT=$BackendCaller"
gcloud.cmd --configuration=adk-owner run services add-iam-policy-binding pinboard-adk --project=project2adk-514723 --region=us-central1 --member="serviceAccount:$BackendCaller" --role="roles/run.invoker"
```

Check that the only intended invoker is the partner's backend runtime account:

```powershell
gcloud.cmd --configuration=adk-owner run services get-iam-policy pinboard-adk --project=project2adk-514723 --region=us-central1
gcloud.cmd --configuration=adk-owner run services describe pinboard-adk --project=project2adk-514723 --region=us-central1 --format="yaml(status.url,status.latestReadyRevisionName,status.conditions,spec.template.spec.serviceAccountName,spec.template.spec.containers[0].env)"
```

Keep the service private. Do not deploy the ADK development UI in production.
The direct health endpoint is `https://<ADK_CLOUD_RUN_URL>/healthz`, but an
unauthenticated browser/curl request is expected to be rejected by Cloud Run.
The end-to-end authenticated workflow in step 5 is the meaningful health check.

### 4. Configure the partner's backend Cloud Run service

The backend owner signs into the backend project and sets the ADK service URL
as a **server-side Cloud Run environment variable**. This creates a new API
revision. It does not expose the URL or credentials to the frontend.

```powershell
gcloud.cmd --configuration=partner-backend run services describe project-2-api --project=project-2-pinboard-2026 --region=us-central1 --format="value(spec.template.spec.serviceAccountName)"
$AdkUrl = "https://pinboard-adk-adiuzklbmq-uc.a.run.app"
gcloud.cmd --configuration=partner-backend run services update project-2-api --project=project-2-pinboard-2026 --region=us-central1 --update-env-vars="ADK_AGENT_URL=$AdkUrl"
gcloud.cmd --configuration=partner-backend run services describe project-2-api --project=project-2-pinboard-2026 --region=us-central1 --format="yaml(status.url,status.latestReadyRevisionName,status.conditions,spec.template.spec.serviceAccountName,spec.template.spec.containers[0].env)"
```

The configured backend service account must exactly match
`ADK_EXPECTED_CALLER_SERVICE_ACCOUNT` and have `roles/run.invoker` on the agent
service. Cloud Run's service identity obtains the Google-signed ID token; do
not create or distribute a service-account key. The backend project owner can
check health and logs at [the API service page](https://console.cloud.google.com/run/detail/us-central1/project-2-api?project=project-2-pinboard-2026)
and [backend Logs Explorer](https://console.cloud.google.com/logs/query?project=project-2-pinboard-2026).

### 5. Redeploy and test the frontend workflow

The frontend lives in the separate `Web-SystemPROJECT2FRONTEND` repository.
Its `.firebaserc` targets `project-2-pinboard-2026`; its build-time
`VITE_API_BASE_URL` must point to `https://project-2-api-m5lsuu6ouq-uc.a.run.app`.
From the frontend project directory:

```powershell
cd "$env:USERPROFILE\WebstormProjects\Web-SystemPROJECT2FRONTEND\Pintrest\pintrest"
npm ci
npm run build
npx firebase-tools login
npx firebase-tools deploy --only hosting --project project-2-pinboard-2026
```

Open [Firebase Hosting](https://console.firebase.google.com/project/project-2-pinboard-2026/hosting/sites)
and test the deployed site. Sign in, create or select a creation with an
uploaded source image, enter instructions, and run the agent workflow. Confirm
that the request completes, the generated image is saved, and the creation
status is `completed`. Do not call the ADK service from browser code.

The agent project should show Gemini requests in [Vertex AI API metrics](https://console.cloud.google.com/apis/api/aiplatform.googleapis.com/metrics?project=project2adk-514723)
and structured agent logs in [Logs Explorer](https://console.cloud.google.com/logs/query?project=project2adk-514723)
with filter `jsonPayload.event="gemini_api_call"`. API-side workflow errors
appear in [the backend logs](https://console.cloud.google.com/logs/query?project=project-2-pinboard-2026).
A direct unauthenticated request to the private agent URL is not a valid test.

### 6. Cross-project access and rollback

With the current signed-URL design, the agent service has **no direct IAM
access** to the backend project's Firestore or media bucket. The only required
cross-project permission is `roles/run.invoker` for the backend runtime service
account on the private agent service. Do not grant broad project Editor access,
Firestore access, or bucket access for this workflow.

To roll back, first identify the previous ready revision, then send all traffic
to that revision in the agent project:

```powershell
gcloud.cmd --configuration=adk-owner run revisions list --service=pinboard-adk --project=project2adk-514723 --region=us-central1
gcloud.cmd --configuration=adk-owner run services update-traffic pinboard-adk --project=project2adk-514723 --region=us-central1 --to-revisions=<PREVIOUS_READY_REVISION>=100
```

For an API-only rollback, use the backend project and service with its previous
ready revision:

```powershell
gcloud.cmd --configuration=partner-backend run revisions list --service=project-2-api --project=project-2-pinboard-2026 --region=us-central1
gcloud.cmd --configuration=partner-backend run services update-traffic project-2-api --project=project-2-pinboard-2026 --region=us-central1 --to-revisions=<PREVIOUS_READY_REVISION>=100
```

If an agent revision is healthy but the backend should temporarily stop calling
it, the backend owner can restore the prior `ADK_AGENT_URL` or remove the
variable; the workflow will then return `AGENT_UNAVAILABLE`. Keep frontend
changes, backend configuration, and agent revisions coordinated during rollback.

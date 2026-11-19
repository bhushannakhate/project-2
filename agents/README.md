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

## Files

| File                                    | Purpose                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                            | Builds the Python 3.12 Cloud Run container and starts Uvicorn.                                                                     |
| `requirements.txt`                      | Pins the ADK, FastAPI/Uvicorn, Google Auth/GenAI, and HTTP client dependencies.                                                    |
| `server.py`                             | FastAPI endpoint, Cloud Run caller-token verification, one-invocation runner, and in-memory session lifecycle.                     |
| `pinboard_agents/.env.example`          | Local non-secret defaults and placeholders for the ADK project and teammate's media bucket.                                        |
| `pinboard_agents/.env`                  | Ignored, local-only configuration loaded when the agent package starts.                                                            |
| `pinboard_agents/credentials/`          | Reserved folder; intentionally contains no credential files. Use ADC locally and an attached runtime service account on Cloud Run. |
| `pinboard_agents/agent.py`              | The Creative Coordinator, Image Retrieval, Audio Processing, Review, and Publishing agents and their ordered workflow.             |
| `pinboard_agents/tools/media_tools.py`  | Restricts and reads signed media URLs, then transcribes the user's uploaded audio.                                                 |
| `pinboard_agents/tools/gemini_tools.py` | Analyzes the imported photo, edits it with Gemini, enforces one review revision, and prepares the result for Express.              |
| `pinboard_agents/__init__.py`           | Exposes the ADK `root_agent` to the ADK development UI.                                                                            |
| `tests/test_session_isolation.py`       | Checks separation for two user IDs and two creation IDs.                                                                           |
| `tests/test_media_url_scope.py`         | Verifies signed media URLs cannot cross user or creation boundaries.                                                               |
| `tests/test_workflow_inputs.py`         | Verifies text-only, audio-only, combined-input, and empty-input request validation.                                                |

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

## Two-project Cloud Run deployment

Do not run these commands until the project owners have supplied the placeholder
values. The ADK project owns only the private service and its Vertex AI access.
The teammate's project continues to own Firebase Auth, Firestore, Google Photos
OAuth, Express, and the media bucket.

### ADK project owner

Enable the required APIs and grant the ADK runtime service account only the model
invocation role in the ADK project:

```bash
gcloud services enable run.googleapis.com aiplatform.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=<ADK_PROJECT_ID>
gcloud projects add-iam-policy-binding <ADK_PROJECT_ID> --member="serviceAccount:<ADK_RUNTIME_SERVICE_ACCOUNT_EMAIL>" --role="roles/aiplatform.user"
```

For local development, the ADK project owner may grant the developer's ADC
identity the same model invocation role if it does not already have access:

```bash
gcloud projects add-iam-policy-binding <ADK_PROJECT_ID> --member="user:<LOCAL_DEVELOPER_EMAIL>" --role="roles/aiplatform.user"
```

From the backend repository root, deploy the service privately. Supply the actual
supported model IDs and the teammate's media bucket name; these values are
configuration, not credentials.

```bash
gcloud run deploy <ADK_SERVICE_NAME> --source agents --project=<ADK_PROJECT_ID> --region=<ADK_REGION> --service-account=<ADK_RUNTIME_SERVICE_ACCOUNT_EMAIL> --no-allow-unauthenticated --concurrency=2 --memory=1Gi --timeout=900 --set-env-vars="NODE_ENV=production,GOOGLE_CLOUD_PROJECT=<ADK_PROJECT_ID>,GOOGLE_CLOUD_LOCATION=<VERTEX_AI_REGION_OR_GLOBAL>,GOOGLE_GENAI_USE_VERTEXAI=TRUE,GEMINI_TEXT_MODEL=<SUPPORTED_GEMINI_TEXT_MODEL>,GEMINI_IMAGE_MODEL=<SUPPORTED_VERTEX_AI_IMAGE_MODEL>,MEDIA_STORAGE_BUCKET=<TEAM_MEDIA_BUCKET_NAME>"
```

Once deployed, configure the exact Cloud Run URL as the accepted token audience and
the Express caller's runtime service account as the only accepted caller:

```bash
ADK_URL="$(gcloud run services describe <ADK_SERVICE_NAME> --project=<ADK_PROJECT_ID> --region=<ADK_REGION> --format='value(status.url)')"
gcloud run services update <ADK_SERVICE_NAME> --project=<ADK_PROJECT_ID> --region=<ADK_REGION> --update-env-vars="ADK_EXPECTED_AUDIENCE=${ADK_URL},ADK_EXPECTED_CALLER_SERVICE_ACCOUNT=<BACKEND_CALLER_SERVICE_ACCOUNT_EMAIL>"
```

Grant that backend runtime service account Cloud Run invoker on this one service:

```bash
gcloud run services add-iam-policy-binding <ADK_SERVICE_NAME> --project=<ADK_PROJECT_ID> --region=<ADK_REGION> --member="serviceAccount:<BACKEND_CALLER_SERVICE_ACCOUNT_EMAIL>" --role="roles/run.invoker"
```

The ADK project owner runs the API, deployment, audience, and invoker commands.
Do not allow unauthenticated access or deploy the development UI.

### Backend project owner

Set `ADK_AGENT_URL` on the Express Cloud Run service to the ADK service URL returned
by deployment. The existing Express runtime service account is the caller; do not
put an ID token, service-account key, Firebase credential, or ADK URL in React.

```bash
gcloud run services update <BACKEND_SERVICE_NAME> --project=<BACKEND_PROJECT_ID> --region=<BACKEND_REGION> --update-env-vars="ADK_AGENT_URL=<ADK_CLOUD_RUN_SERVICE_URL>"
```

The backend project owner runs this configuration command and confirms the
existing Express runtime identity. No Photos OAuth token is sent to ADK.

### Cross-project data permissions

With the signed-URL design above, ADK has **no IAM access to the teammate's
Firestore or Cloud Storage bucket**. Express performs ownership checks and issues
15-minute read-only URLs for only the current creation's validated source image
and user-uploaded audio. The ADK service validates the URL host, bucket, user ID,
creation ID, and media kind before fetching. Express saves generated media and
durable metadata through its existing upload-completion and Firestore helpers.
The only required cross-project grant is `roles/run.invoker` on the ADK service
for the Express runtime service account.

If a later design removes signed URLs and gives ADK direct media access, grant its
runtime service account `roles/storage.objectViewer` on the specific media bucket
only (not the whole backend project). Direct Firestore access is not needed; if
approved in a future design, grant only the narrow read role
`roles/datastore.viewer` on the specific Firestore database. Do not grant ADK
`roles/datastore.user` or project-wide Editor for this workflow.

The backend project owner would run these optional bindings only after approving
a design that gives ADK direct read access; they are **not required** for this
signed-URL workflow:

```bash
gcloud storage buckets add-iam-policy-binding gs://<TEAM_MEDIA_BUCKET_NAME> --member="serviceAccount:<ADK_RUNTIME_SERVICE_ACCOUNT_EMAIL>" --role="roles/storage.objectViewer"
gcloud firestore databases add-iam-policy-binding <DATABASE_ID> --project=<BACKEND_PROJECT_ID> --member="serviceAccount:<ADK_RUNTIME_SERVICE_ACCOUNT_EMAIL>" --role="roles/datastore.viewer"
```

### PowerShell Cloud Run commands

The same commands can be run in PowerShell with quoted placeholders:

```powershell
gcloud services enable run.googleapis.com aiplatform.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=<ADK_PROJECT_ID>
gcloud projects add-iam-policy-binding <ADK_PROJECT_ID> --member="serviceAccount:<ADK_RUNTIME_SERVICE_ACCOUNT_EMAIL>" --role="roles/aiplatform.user"
gcloud run deploy <ADK_SERVICE_NAME> --source agents --project=<ADK_PROJECT_ID> --region=<ADK_REGION> --service-account=<ADK_RUNTIME_SERVICE_ACCOUNT_EMAIL> --no-allow-unauthenticated --concurrency=2 --memory=1Gi --timeout=900 --set-env-vars="NODE_ENV=production,GOOGLE_CLOUD_PROJECT=<ADK_PROJECT_ID>,GOOGLE_CLOUD_LOCATION=<VERTEX_AI_REGION_OR_GLOBAL>,GOOGLE_GENAI_USE_VERTEXAI=TRUE,GEMINI_TEXT_MODEL=<SUPPORTED_GEMINI_TEXT_MODEL>,GEMINI_IMAGE_MODEL=<SUPPORTED_VERTEX_AI_IMAGE_MODEL>,MEDIA_STORAGE_BUCKET=<TEAM_MEDIA_BUCKET_NAME>"
$AdkUrl = gcloud run services describe <ADK_SERVICE_NAME> --project=<ADK_PROJECT_ID> --region=<ADK_REGION> --format="value(status.url)"
gcloud run services update <ADK_SERVICE_NAME> --project=<ADK_PROJECT_ID> --region=<ADK_REGION> --update-env-vars="ADK_EXPECTED_AUDIENCE=$AdkUrl,ADK_EXPECTED_CALLER_SERVICE_ACCOUNT=<BACKEND_CALLER_SERVICE_ACCOUNT_EMAIL>"
gcloud run services add-iam-policy-binding <ADK_SERVICE_NAME> --project=<ADK_PROJECT_ID> --region=<ADK_REGION> --member="serviceAccount:<BACKEND_CALLER_SERVICE_ACCOUNT_EMAIL>" --role="roles/run.invoker"
gcloud run services update <BACKEND_SERVICE_NAME> --project=<BACKEND_PROJECT_ID> --region=<BACKEND_REGION> --update-env-vars="ADK_AGENT_URL=$AdkUrl"
```

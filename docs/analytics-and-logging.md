# Analytics and Logging setup

The React UI is in the separate `Web-SystemPROJECT2FRONTEND\Pintrest\pintrest`
directory. It initializes GA4 from `VITE_GA4_MEASUREMENT_ID`, records route
pageviews and agent-workflow starts, and forwards GA client/session IDs with
agent requests. Express sends the matching server-side workflow result event.
Cloud Logging records Express-to-ADK requests and direct ADK-to-Gemini calls.

## 1. Create a GA4 property and Measurement Protocol secret

1. In Google Analytics, create or select a GA4 property.
2. Under **Admin → Data streams**, add a **Web** stream for
   `https://project-2-pinboard-2026.web.app`. Copy its Measurement ID (`G-...`).
3. In that stream, create a **Measurement Protocol API secret**. This is
   different from the Measurement ID; keep it private and server-side.

## 2. Configure the React app

In the UI project, add this line to the ignored `.env.local`, preserving its
existing Firebase and API settings:

```dotenv
VITE_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
```

Restart `npm run dev` for local testing. The UI sends route pageviews and
`agent_workflow_started` events. When it calls the agent endpoint, it forwards
the GA client/session IDs so the server-side result event can be attributed to
that visitor. The API secret must never be added to the frontend.

To publish the static UI, run these commands from
`Web-SystemPROJECT2FRONTEND\Pintrest\pintrest` after setting `.env.local`:

```powershell
npm run build
npx firebase-tools deploy --only hosting --project project-2-pinboard-2026
```

Firebase Hosting serves the compiled static files; Vite embeds the public
Measurement ID at build time.

## 3. Configure the Express API

For local development, add both settings to the backend's ignored `.env`:

```dotenv
GA4_MEASUREMENT_ID=G-XXXXXXXXXX
GA4_API_SECRET=your-measurement-protocol-secret
```

Restart Express after editing `.env`. Server events are disabled unless both
settings are present and a valid GA client ID is forwarded by the UI. Events
contain workflow outcome, duration, optional revision count, and GA client and
session IDs; they exclude prompts, image/audio data, Firebase UIDs, and
creation IDs. GA delivery errors are reported but do not fail a workflow.

For production, in the `project-2-pinboard-2026` project:

1. In **Secret Manager**, create `ga4-api-secret` and add the Measurement
   Protocol API secret as a new version.
2. Grant
   `pinboard-api-runtime@project-2-pinboard-2026.iam.gserviceaccount.com`
   **Secret Manager Secret Accessor** on that secret and
   `roles/logging.logWriter` in the project.
3. Open **Cloud Run → project-2-api → Edit and deploy new revision**. Set
   `GA4_MEASUREMENT_ID` to the Measurement ID and map `GA4_API_SECRET` to
   `ga4-api-secret:latest` as a Secret Manager environment variable. Deploy.

## 4. Enable and view Cloud Logging

In the API project's Cloud Run logs, `external-api-requests` records each
Express-to-ADK workflow request, including outcome, HTTP status, duration, and
request ID. React's API requests are also visible in the Express request logs.
The browser must not hold Google Cloud Logging credentials.

The ADK service makes the direct Gemini calls in a separate Google Cloud
project. Grant its Cloud Run runtime service account
`roles/logging.logWriter` in that ADK project. The ADK dependency and code are
updated to write one structured `gemini_api_call` record for each successful or
failed Gemini request, including model, workflow stage, outcome, duration, and
request ID—but no prompts or media. Redeploy the ADK service from the backend
repository using the existing deployment instructions in `agents/README.md`.

In Logs Explorer, select the API project and use:

```text
logName="projects/project-2-pinboard-2026/logs/external-api-requests"
jsonPayload.event="external_api_call"
```

Then select the ADK project and use:

```text
logName="projects/ADK_PROJECT_ID/logs/gemini-api-requests"
jsonPayload.event="gemini_api_call"
```

Replace `ADK_PROJECT_ID` with the project that owns the ADK Cloud Run service.

## 5. Verify events and prepare the report

Open the deployed UI, navigate between pages, and run an agent workflow. Check
**GA4 → Reports → Realtime** for pageviews and workflow events; server events
may take longer to appear. In **Admin → Custom definitions**, register
`workflow_status` as an event-scoped custom dimension and `duration_ms` as a
custom metric before using those parameters in reports. Cloud Logging records
are available in Logs Explorer after the corresponding runtime roles are
granted and the updated services are deployed.

For the assignment report, useful metrics are daily/weekly active users,
pageviews or engagement by route, and agent workflow success rate (completed
events divided by completed plus failed events). Build time-series charts in
GA4 Explore after collecting real traffic. State date ranges, units, and
limitations such as consent/ad blockers, small samples, and the difference
between engagement and task success. The requested PDF/wiki page still needs
real collected data and must be published by a teammate with wiki access.

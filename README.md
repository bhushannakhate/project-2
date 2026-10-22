# Project 2 — Pinboard Studio Customer API

Express API backed by Google Cloud Firestore. The `customers` collection stores customer profiles and the API exposes the newest 10 records for the React customer directory.

## Customer document fields

Required: `fullName`, `email`, `username`. Optional: `phone`, `bio`, `interests` (up to 20 strings), `preferredCategory`, and `marketingOptIn`. The API normalizes email, validates input, prevents duplicate email addresses, and adds a server-generated `createdAt` timestamp and Firestore document ID. Passwords are intentionally not stored in this profile collection; use a dedicated identity provider such as Firebase Authentication for authentication.

## Run locally

1. Create a Google Cloud project, enable billing and the Firestore API, and create a Firestore Native-mode database.
2. Install the Google Cloud CLI and authenticate locally with Application Default Credentials: `gcloud auth application-default login`.
3. Copy `.env.example` to `.env`, then set `FIRESTORE_PROJECT_ID` to the project ID. Keep `.env` and credential files private; do not commit service-account keys.
4. From this directory run `npm install` and `npm run dev`.
5. In a second terminal, run the Vite app from `../` using `npm run dev`. Visit `/customers`, submit a profile, then see the first 10 records.

To populate the lab collection with 10 clearly fictional examples, authenticate with the Google Cloud project and run `npm run seed:demo` once. This explicit command writes records named `demo-001` through `demo-010`; it never runs automatically. Use only fictional data for screenshots and delete the sample records when no longer needed.

The local React dev server proxies `/api` to `http://localhost:4000`. The API also serves `GET /api/health`, `GET /api/customers?limit=10`, and `POST /api/customers`.

## Deploy the API to Cloud Run

Deploy this directory as the source/build context for its included Dockerfile. Configure `FIRESTORE_PROJECT_ID` and `WEB_ORIGIN` (the deployed web app's exact origin) as Cloud Run environment variables. Give the Cloud Run runtime service account the `roles/datastore.user` role on the Firestore project; use Cloud Run's attached identity instead of a downloadable key. Set Cloud Run authentication to allow unauthenticated requests only if this public customer demo is intended to be accessible to everyone. The API validates input but production deployments should additionally apply abuse controls and privacy/retention policies.

Set `VITE_API_BASE_URL` to the deployed API's HTTPS base URL when building the frontend, for example in the static-site build environment. This variable is public configuration, not a secret. Rebuild and redeploy the frontend after changing it.

# Project 2 — Pinboard Studio Customer API

Express API backed by MongoDB. The `customers` collection stores customer profiles and the API exposes the newest 10 records for the React customer directory.

## Customer document fields

Required: `fullName`, `email`, `username`. Optional: `phone`, `bio`, `interests` (up to 20 strings), `preferredCategory`, and `marketingOptIn`. The API normalizes email, validates input, prevents duplicate email addresses with a unique database index, and adds a server-generated `createdAt` timestamp and MongoDB ID. Passwords are intentionally not stored in this profile collection; use a dedicated identity provider for authentication.

## Run locally

1. Create a MongoDB Atlas cluster (or use a local MongoDB server), create a database user, and allow the API host in the Atlas network access list.
2. Copy `.env.example` to `.env` (or add these settings to an existing `.env`). Set `MONGODB_URI` to your MongoDB connection string and set `MONGODB_DATABASE` to the database name to use. Keep `.env` private; never commit credentials.
3. From this directory run `npm install` and `npm run dev`.
4. In a second terminal, run the Vite app from `../` using `npm run dev`. Visit `/customers`, submit a profile, then see the first 10 records.

To populate the database with 10 clearly fictional examples, run `npm run seed:demo` once. This explicit command upserts records named `demo-001` through `demo-010`; it never runs automatically. Use only fictional data for screenshots and delete the sample records when no longer needed.

The local React dev server proxies `/api` to `http://localhost:4000`. If the browser opens the frontend as `http://127.0.0.1:5173`, include that exact origin in the backend's comma-separated `WEB_ORIGIN` setting as well as `http://localhost:5173`; browsers treat them as different origins. The API also serves `GET /api/health`, `GET /api/customers?limit=10`, `POST /api/customers`, `PATCH /api/customers/:id`, and `DELETE /api/customers/:id`.

### Customer API

- `GET /api/customers?limit=10` — list up to 10 newest records.
- `POST /api/customers` — create a customer. Required JSON fields: `fullName`, `email`, `username`. Optional: `phone`, `bio`, `interests`, `preferredCategory`, `marketingOptIn`.
- `PATCH /api/customers/:id` — update a customer's profile by MongoDB ID. Send the complete customer profile using the same JSON fields as `POST`; the existing `createdAt` timestamp is retained and `updatedAt` is added. Duplicate emails and missing IDs return `409` and `404` respectively.
- `DELETE /api/customers/:id` — permanently delete the customer by MongoDB ID. A successful request returns `{ "message": "Customer deleted.", "id": "..." }`; an unknown ID returns `404`.

Example update: `curl -X PATCH http://localhost:4000/api/customers/demo-001 -H 'Content-Type: application/json' -d '{"fullName":"Avery Morgan","email":"avery.morgan@example.test","username":"averym","phone":"","bio":"Updated sample profile","interests":["watercolor"],"preferredCategory":"Art & illustration","marketingOptIn":false}'`. Example deletion: `curl -X DELETE http://localhost:4000/api/customers/demo-001`. Deletion is permanent; verify the ID before sending the request.

The `/customers` page provides **Edit** and **Delete** actions for each displayed customer. Editing loads the saved profile into the form; deleting asks for confirmation before permanently removing the record.

### View the database

Use MongoDB Atlas Data Explorer (or your local MongoDB client) to inspect the database named by `MONGODB_DATABASE` and its `customers` collection. You can also list documents through the API: `curl http://localhost:4000/api/customers?limit=10`.

## Deploy the API

Deploy this directory using the included Dockerfile. Configure `MONGODB_URI`, `MONGODB_DATABASE`, and `WEB_ORIGIN` (the deployed web app's exact origin) in the hosting provider's secret/environment settings. Store the MongoDB connection string as a secret and restrict the database user's privileges to the required database. Set hosting-provider authentication to allow unauthenticated requests only if this public customer demo is intended to be accessible to everyone. The API validates input, but production deployments should additionally apply abuse controls and privacy/retention policies.

Set `VITE_API_BASE_URL` to the deployed API's HTTPS base URL when building the frontend, for example in the static-site build environment. This variable is public configuration, not a secret. Rebuild and redeploy the frontend after changing it.

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

Run `npm run firebase:check` to verify the selected Firebase project and service-account configuration. Keep service-account files private in the ignored `credentials/` directory; production deployments should provide a mounted credential via `GOOGLE_APPLICATION_CREDENTIALS` or use the hosting platform's workload identity.

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

All Firestore endpoints require `Authorization: Bearer <Firebase ID token>`. Firebase Admin verifies the token signature, expiry, issuer, and project audience, and checks whether the token was revoked. Successful authentication exposes the Firebase UID and profile claims to route handlers as `request.user`; invalid, expired, or revoked tokens receive the standard `401 UNAUTHENTICATED` response. Authorization failures use `403` responses in the same error format. Tokens are never included in API logs or error responses.

| Method   | Endpoint                                                   | Purpose                                                    |
| -------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `GET`    | `/api/users/me`                                            | Get or initialize the authenticated user profile.          |
| `PATCH`  | `/api/users/me`                                            | Update allowed profile fields (`displayName`, `photoURL`). |
| `GET`    | `/api/creations?limit=20&status=draft&cursor=<creationId>` | List the user's creations.                                 |
| `GET`    | `/api/creations/:creationId`                               | Get one owned creation.                                    |
| `POST`   | `/api/creations`                                           | Create a creation.                                         |
| `PATCH`  | `/api/creations/:creationId`                               | Update an owned creation.                                  |
| `DELETE` | `/api/creations/:creationId`                               | Soft-delete an owned creation.                             |

Deploy Firestore rules and indexes with `firebase deploy --only firestore`.

## Optional demo customer API

The MongoDB customer API is disabled by default and is not required for normal startup. To enable it, set `DEMO_CUSTOMERS_ENABLED=true`, configure `MONGODB_URI`, optionally set `MONGODB_DATABASE`, and restart the API. Its endpoints are mounted under `/api/demo/customers` (`GET`, `POST`, `PATCH /:id`, and `DELETE /:id`). The explicit `npm run seed:demo` command inserts fictional sample records; seeding never runs during server startup.

## Project structure

- `src/config`: environment, CORS, and Firebase configuration
- `src/routes`: Firestore and optional demo route declarations
- `src/controllers`: HTTP request/response handling
- `src/services`: Firestore and customer operations
- `src/middleware`: async handling, authentication, validation, not-found, and error responses
- `src/models`: MongoDB customer ID mapping and demo validation
- `src/app.js`: Express middleware and route composition
- `src/server.js`: service initialization and HTTP startup
- `src/index.js`: importable app entry point

## Development checks

- `npm test` runs the Node.js test suite.
- `npm run lint` runs ESLint.
- `npm run format` formats source, tests, scripts, package metadata, and this README.
- `npm run format:check` checks formatting without changes.
- `npm run check` runs lint, formatting checks, and tests.

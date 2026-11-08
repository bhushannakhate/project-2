# Project 2 API

Maintainable Express 5 API foundation. Normal startup does not connect to MongoDB or load customer demo routes. The optional customer demo is mounted only at `/api/demo/customers` when explicitly enabled.

## Run locally

Requires Node.js 20 or newer.

1. Copy `.env.example` to `.env`.
2. Run `npm install`.
3. Run `npm run dev` for watch mode or `npm start` for normal startup.

The API listens on port `4000` by default. Configure `PORT`, `NODE_ENV`, and the comma-separated allowed browser origins in `WEB_ORIGIN` as needed. CORS allows requests without an `Origin` header, such as health probes and command-line clients.

## Health and errors

`GET /api/health` returns `200` with `{"status":"ok"}`.

All API errors use the same response shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found: GET /api/unknown"
  }
}
```

Error codes include `VALIDATION_ERROR`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `CORS_ORIGIN_DENIED`, `NOT_FOUND`, `CONFLICT`, and `INTERNAL_SERVER_ERROR`. Request JSON is limited to 20kb.

## Optional demo customer API

The MongoDB-backed customer CRUD API is demo-only and disabled by default. To enable it, set `DEMO_CUSTOMERS_ENABLED=true`, provide `MONGODB_URI`, and optionally set `MONGODB_DATABASE`. Restart with `npm run dev` or `npm start`. The demo API is then available at `/api/demo/customers` with `GET`, `POST`, `PATCH /:id`, and `DELETE /:id`.

To insert fictional sample records, run `npm run seed:demo` explicitly after configuring `MONGODB_URI`. Seeding does not run during normal application startup.

## Project structure

- `src/config`: validated environment and CORS configuration
- `src/routes`: route declarations and middleware composition
- `src/controllers`: HTTP request/response handling
- `src/services`: application operations
- `src/middleware`: async handling, validation, not-found, and error responses
- `src/models`: MongoDB access and demo-customer validation
- `src/app.js`: Express application configuration
- `src/server.js`: optional service initialization and HTTP startup
- `src/index.js`: application entry point for importing the configured app

## Development checks

- `npm test` runs the built-in Node.js test suite.
- `npm run lint` runs ESLint.
- `npm run format` formats source, tests, scripts, package metadata, and this README.
- `npm run format:check` checks formatting without changes.

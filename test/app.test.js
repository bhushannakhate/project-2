import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";
import { ApiError, errorHandler } from "../src/middleware/errorHandler.js";

const config = {
  port: 4000,
  nodeEnv: "test",
  allowedOrigins: ["http://localhost:5173"],
  demoCustomersEnabled: false,
};

async function withServer(app, run) {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("health endpoint reports availability and security headers", async () => {
  await withServer(createApp({ config }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });
});

test("unknown routes use the standard API error format", async () => {
  await withServer(createApp({ config }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/missing`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: {
        code: "NOT_FOUND",
        message: "Route not found: GET /api/missing",
      },
    });
  });
});

test("Firestore routes require a Firebase bearer token", async () => {
  await withServer(createApp({ config }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/creations`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: {
        code: "UNAUTHENTICATED",
        message: "A Firebase bearer token is required.",
      },
    });
  });
});

test("malformed JSON uses the standard API error format", async () => {
  await withServer(createApp({ config }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/demo/customers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON.",
      },
    });
  });
});

test("requests larger than the JSON limit are rejected", async () => {
  await withServer(createApp({ config }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/missing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(21 * 1024) }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the 20kb limit.",
      },
    });
  });
});

test("disallowed browser origins are rejected", async () => {
  await withServer(createApp({ config }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: "https://example.invalid" },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: {
        code: "CORS_ORIGIN_DENIED",
        message: "This website origin is not allowed by the API.",
      },
    });
  });
});

test("expected service-unavailable errors preserve their safe API response", () => {
  const response = {
    headersSent: false,
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };

  errorHandler(
    new ApiError(
      503,
      "GOOGLE_PHOTOS_NOT_CONFIGURED",
      "Google Photos is not configured for this service.",
    ),
    {},
    response,
    assert.fail,
  );

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    error: {
      code: "GOOGLE_PHOTOS_NOT_CONFIGURED",
      message: "Google Photos is not configured for this service.",
    },
  });
});

test("unexpected server errors remain redacted", () => {
  const response = {
    headersSent: false,
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };

  errorHandler(
    new Error("sensitive upstream detail"),
    {},
    response,
    assert.fail,
  );

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
});

test("customer demo routes are absent unless explicitly enabled", async () => {
  await withServer(createApp({ config }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/demo/customers`);
    assert.equal(response.status, 404);
  });
});

test("enabling customer demo routes requires a MongoDB collection", () => {
  assert.throws(
    () =>
      createApp({
        config: { ...config, demoCustomersEnabled: true },
      }),
    /MongoDB customer collection is required/,
  );
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import app from "../src/index.js";

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("health endpoint reports availability and security headers", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("unknown routes use the standard API error format", async () => {
  const response = await fetch(`${baseUrl}/api/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: "NOT_FOUND",
      message: "Route not found: GET /api/missing",
    },
  });

  const demoResponse = await fetch(`${baseUrl}/api/demo/customers`);
  assert.equal(demoResponse.status, 404);
});

test("malformed JSON uses the standard API error format", async () => {
  const response = await fetch(`${baseUrl}/api/demo/customers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"broken":',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INVALID_JSON",
      message: "Request body must contain valid JSON.",
    },
  });
});

test("requests larger than the JSON limit are rejected", async () => {
  const response = await fetch(`${baseUrl}/api/demo/customers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(21 * 1024) }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: {
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeds the 20kb limit.",
    },
  });
});

test("disallowed browser origins are rejected", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "https://not-allowed.example" },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "CORS_ORIGIN_DENIED",
      message: "Request origin is not allowed.",
    },
  });
});

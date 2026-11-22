import assert from "node:assert/strict";
import test from "node:test";
import { logExternalApiCall } from "../src/services/cloudLoggingService.js";

test("writes a structured external API event to Cloud Logging", async () => {
  const entry = {
    metadata: null,
    payload: null,
  };
  const loggingClient = {
    log(name) {
      assert.equal(name, "external-api-requests");
      return {
        entry(metadata, payload) {
          entry.metadata = metadata;
          entry.payload = payload;
          return entry;
        },
        async write(value) {
          assert.equal(value, entry);
        },
      };
    },
  };

  await logExternalApiCall(
    {
      service: "Google ADK agent",
      operation: "workflow",
      outcome: "success",
      statusCode: 200,
      durationMs: 456,
      requestId: "request-123",
    },
    { loggingClient },
  );

  assert.equal(entry.metadata.resource.type, "global");
  assert.equal(entry.metadata.severity, "INFO");
  assert.deepEqual(entry.payload, {
    event: "external_api_call",
    service: "Google ADK agent",
    operation: "workflow",
    outcome: "success",
    statusCode: 200,
    durationMs: 456,
    requestId: "request-123",
  });
});

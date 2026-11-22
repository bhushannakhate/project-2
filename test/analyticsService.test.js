import assert from "node:assert/strict";
import test from "node:test";
import { sendAnalyticsEvent } from "../src/services/analyticsService.js";

const config = {
  ga4MeasurementId: "G-ABC123",
  ga4ApiSecret: "server-only-secret",
};

test("sends a server event with the browser GA client and session IDs", async () => {
  let request;
  const sent = await sendAnalyticsEvent(
    config,
    { clientId: "123456789.1234567890", sessionId: "987654321" },
    "agent_workflow",
    { workflow_status: "completed", duration_ms: 1234 },
    {
      fetchImpl: async (url, options) => {
        request = { url: new URL(url), options };
        return new Response(null, { status: 204 });
      },
    },
  );

  assert.equal(sent, true);
  assert.equal(
    request.url.searchParams.get("measurement_id"),
    config.ga4MeasurementId,
  );
  assert.equal(request.url.searchParams.get("api_secret"), config.ga4ApiSecret);
  assert.deepEqual(JSON.parse(request.options.body), {
    client_id: "123456789.1234567890",
    events: [
      {
        name: "agent_workflow",
        params: {
          workflow_status: "completed",
          duration_ms: 1234,
          session_id: 987654321,
        },
      },
    ],
  });
});

test("does not send server events when GA4 is not fully configured", async () => {
  let fetchCalled = false;
  const sent = await sendAnalyticsEvent(
    { ga4MeasurementId: "", ga4ApiSecret: "" },
    { clientId: "123456789.1234567890" },
    "agent_workflow",
    {},
    {
      fetchImpl: async () => {
        fetchCalled = true;
      },
    },
  );

  assert.equal(sent, false);
  assert.equal(fetchCalled, false);
});

test("does not send events without a valid browser client ID", async () => {
  const originalWarn = console.warn;
  let fetchCalled = false;
  console.warn = () => {};
  try {
    const sent = await sendAnalyticsEvent(
      config,
      {},
      "agent_workflow",
      {},
      {
        fetchImpl: async () => {
          fetchCalled = true;
        },
      },
    );
    assert.equal(sent, false);
    assert.equal(fetchCalled, false);
  } finally {
    console.warn = originalWarn;
  }
});

test("does not let GA4 delivery errors fail the API workflow", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      await sendAnalyticsEvent(
        config,
        { clientId: "123456789.1234567890" },
        "agent_workflow",
        {},
        { fetchImpl: async () => new Response(null, { status: 500 }) },
      ),
      false,
    );
  } finally {
    console.warn = originalWarn;
  }
});

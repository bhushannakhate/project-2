import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdkServiceUrl,
  invokeAdkWorkflow,
} from "../src/services/adkAgentService.js";
import { validateAgentWorkflow } from "../src/middleware/validateAgentWorkflow.js";

test("ADK URL permits local HTTP only on local non-production hosts", () => {
  assert.equal(
    getAdkServiceUrl({
      adkAgentUrl: "http://127.0.0.1:8000",
      nodeEnv: "development",
    }),
    "http://127.0.0.1:8000",
  );
  assert.equal(
    getAdkServiceUrl({
      adkAgentUrl: "https://agent.example.test",
      nodeEnv: "production",
    }),
    "https://agent.example.test",
  );
  for (const config of [
    { adkAgentUrl: "http://agent.example.test", nodeEnv: "development" },
    { adkAgentUrl: "http://localhost:8000", nodeEnv: "production" },
    {
      adkAgentUrl: "https://user:secret@agent.example.test",
      nodeEnv: "production",
    },
    { adkAgentUrl: "https://agent.example.test/path", nodeEnv: "production" },
  ]) {
    assert.throws(() => getAdkServiceUrl(config), {
      code: "AGENT_UNAVAILABLE",
    });
  }
});

test("agent workflow accepts typed instructions without requiring audio", () => {
  const request = {
    body: {
      instructions: "Make the background brighter.",
      includeAudio: false,
    },
  };
  let nextCalled = false;
  validateAgentWorkflow(request, {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(request.agentInstructions, "Make the background brighter.");
  assert.equal(request.agentIncludeAudio, false);

  const audioOnlyRequest = {
    body: { instructions: "", includeAudio: true },
  };
  validateAgentWorkflow(audioOnlyRequest, {}, () => {});
  assert.equal(audioOnlyRequest.agentInstructions, "");
  assert.equal(audioOnlyRequest.agentIncludeAudio, true);

  const combinedRequest = {
    body: { instructions: "Brighten the scene.", includeAudio: true },
  };
  validateAgentWorkflow(combinedRequest, {}, () => {});
  assert.equal(combinedRequest.agentInstructions, "Brighten the scene.");
  assert.equal(combinedRequest.agentIncludeAudio, true);

  let noInputError;
  validateAgentWorkflow(
    { body: { instructions: "", includeAudio: false } },
    {},
    (value) => {
      noInputError = value;
    },
  );
  assert.equal(noInputError.status, 400);

  let error;
  validateAgentWorkflow(
    { body: { instructions: "Edit", userId: "another-user" } },
    {},
    (value) => {
      error = value;
    },
  );
  assert.equal(error.status, 400);
});

test("Vertex AI capacity responses have a safe actionable API error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 429 });
  try {
    await assert.rejects(
      invokeAdkWorkflow(
        {
          adkAgentUrl: "http://127.0.0.1:8000",
          nodeEnv: "development",
        },
        {},
      ),
      {
        status: 429,
        code: "AGENT_CAPACITY_LIMITED",
        message:
          "Gemini is temporarily at capacity. Wait a few minutes before retrying and check Vertex AI quotas.",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

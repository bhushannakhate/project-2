import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdkServiceUrl,
  invokeAdkTranscription,
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
      consentToGemini: true,
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
    body: { instructions: "", includeAudio: true, consentToGemini: true },
  };
  validateAgentWorkflow(audioOnlyRequest, {}, () => {});
  assert.equal(audioOnlyRequest.agentInstructions, "");
  assert.equal(audioOnlyRequest.agentIncludeAudio, true);

  const combinedRequest = {
    body: {
      instructions: "Brighten the scene.",
      includeAudio: true,
      transcript: "Make it brighter.",
      consentToGemini: true,
    },
  };
  validateAgentWorkflow(combinedRequest, {}, () => {});
  assert.equal(combinedRequest.agentInstructions, "Brighten the scene.");
  assert.equal(combinedRequest.agentIncludeAudio, true);
  assert.equal(combinedRequest.agentTranscript, "Make it brighter.");

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
    {
      body: {
        instructions: "Edit",
        userId: "another-user",
        consentToGemini: true,
      },
    },
    {},
    (value) => {
      error = value;
    },
  );
  assert.equal(error.status, 400);

  let consentError;
  validateAgentWorkflow(
    { body: { instructions: "Edit", includeAudio: false } },
    {},
    (value) => {
      consentError = value;
    },
  );
  assert.equal(consentError.code, "GEMINI_CONSENT_REQUIRED");
});

test("Vertex AI capacity responses have a safe actionable API error", async () => {
  const originalFetch = globalThis.fetch;
  const loggedCalls = [];
  globalThis.fetch = async () => new Response(null, { status: 429 });
  try {
    await assert.rejects(
      invokeAdkWorkflow(
        {
          adkAgentUrl: "http://127.0.0.1:8000",
          nodeEnv: "development",
        },
        {},
        { logApiCall: async (call) => loggedCalls.push(call) },
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
  assert.equal(loggedCalls.length, 1);
  assert.equal(loggedCalls[0].service, "Google ADK agent");
  assert.equal(loggedCalls[0].outcome, "failure");
  assert.equal(loggedCalls[0].statusCode, 429);
});

test("ADK transcription requests preserve the owner-bound media contract", async () => {
  const calls = [];
  const result = await invokeAdkTranscription(
    { adkAgentUrl: "http://127.0.0.1:8000", nodeEnv: "development" },
    {
      request_id: "00000000-0000-4000-8000-000000000001",
      user_id: "user-id",
      creation_id: "creation-id",
      audio_url: "https://storage.example/private-audio",
      audio_content_type: "audio/webm",
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(
          JSON.stringify({ transcription: "Make it warmer.", confidence: 0.9 }),
          { status: 200 },
        );
      },
      logApiCall: async () => {},
    },
  );

  assert.deepEqual(result, {
    transcription: "Make it warmer.",
    confidence: 0.9,
  });
  assert.equal(calls[0].url, "http://127.0.0.1:8000/transcriptions");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    request_id: "00000000-0000-4000-8000-000000000001",
    user_id: "user-id",
    creation_id: "creation-id",
    audio_url: "https://storage.example/private-audio",
    audio_content_type: "audio/webm",
  });
});

test("successful ADK calls record their status and duration", async () => {
  const loggedCalls = [];
  const result = await invokeAdkWorkflow(
    {
      adkAgentUrl: "http://127.0.0.1:8000",
      nodeEnv: "development",
    },
    { request_id: "request-123" },
    {
      fetchImpl: async () =>
        new Response(JSON.stringify({ approved: true }), { status: 200 }),
      logApiCall: async (call) => loggedCalls.push(call),
    },
  );

  assert.deepEqual(result, { approved: true });
  assert.equal(loggedCalls.length, 1);
  assert.equal(loggedCalls[0].outcome, "success");
  assert.equal(loggedCalls[0].statusCode, 200);
  assert.equal(loggedCalls[0].requestId, "request-123");
  assert.equal(Number.isInteger(loggedCalls[0].durationMs), true);
});

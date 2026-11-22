import { GoogleAuth } from "google-auth-library";
import { ApiError } from "../middleware/errorHandler.js";
import { logExternalApiCall } from "./cloudLoggingService.js";

const REQUEST_TIMEOUT_MS = 240_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

function agentCapacityError() {
  return new ApiError(
    429,
    "AGENT_CAPACITY_LIMITED",
    "Gemini is temporarily at capacity. Wait a few minutes before retrying and check Vertex AI quotas.",
  );
}

export function getAdkServiceUrl(config) {
  if (!config.adkAgentUrl) {
    throw new ApiError(
      503,
      "AGENT_UNAVAILABLE",
      "The agent service is not configured.",
    );
  }

  let url;
  try {
    url = new URL(config.adkAgentUrl);
  } catch {
    throw new ApiError(
      503,
      "AGENT_UNAVAILABLE",
      "The agent service URL is invalid.",
    );
  }

  const localHttpAllowed =
    config.nodeEnv !== "production" &&
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttpAllowed) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new ApiError(
      503,
      "AGENT_UNAVAILABLE",
      "The agent service URL must be HTTPS, except for local development on localhost or 127.0.0.1.",
    );
  }

  return url.origin;
}

export async function invokeAdkWorkflow(config, workflow, dependencies = {}) {
  const serviceUrl = getAdkServiceUrl(config);
  const endpoint = `${serviceUrl}/workflows`;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const logApiCall = dependencies.logApiCall || logExternalApiCall;
  const startedAt = Date.now();
  let outcome = "failure";
  let statusCode;

  try {
    if (config.nodeEnv === "production") {
      const client = await new GoogleAuth().getIdTokenClient(serviceUrl);
      const response = await client.request({
        url: endpoint,
        method: "POST",
        data: workflow,
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 0,
      });
      statusCode = response.status;
      outcome = "success";
      return response.data;
    }

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workflow),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    statusCode = response.status;
    if (!response.ok) {
      if (response.status === 429) throw agentCapacityError();
      throw new ApiError(
        502,
        "AGENT_UNAVAILABLE",
        "The agent service could not complete the workflow.",
      );
    }
    const result = await response.json();
    outcome = "success";
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.response?.status === 429) throw agentCapacityError();
    throw new ApiError(
      502,
      "AGENT_UNAVAILABLE",
      "The agent service could not complete the workflow.",
    );
  } finally {
    await logApiCall({
      service: "Google ADK agent",
      operation: "workflow",
      outcome,
      statusCode: statusCode || undefined,
      durationMs: Date.now() - startedAt,
      requestId: workflow.request_id,
    });
  }
}

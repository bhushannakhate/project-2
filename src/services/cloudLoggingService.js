import { Logging } from "@google-cloud/logging";

let loggingClient;

export async function logExternalApiCall(
  { service, operation, outcome, statusCode, durationMs, requestId },
  { loggingClient: injectedLoggingClient } = {},
) {
  try {
    const client = injectedLoggingClient || (loggingClient ||= new Logging());
    const log = client.log("external-api-requests");
    const payload = {
      event: "external_api_call",
      service,
      operation,
      outcome,
      durationMs,
      ...(statusCode === undefined ? {} : { statusCode }),
      ...(requestId ? { requestId } : {}),
    };
    const entry = log.entry(
      {
        resource: { type: "global" },
        severity: outcome === "success" ? "INFO" : "ERROR",
      },
      payload,
    );
    await log.write(entry);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "cloud_logging_write_failed",
        errorType: error?.name || "Error",
      }),
    );
  }
}

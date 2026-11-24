const MEASUREMENT_PROTOCOL_URL = "https://www.google-analytics.com/mp/collect";
const CLIENT_ID_PATTERN = /^\d{1,20}\.\d{1,20}$/;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function logDeliveryIssue(reason, details = {}) {
  console.warn(
    JSON.stringify({
      event: "ga4_measurement_protocol_delivery_issue",
      reason,
      ...details,
    }),
  );
}

export async function sendAnalyticsEvent(
  config,
  { clientId, sessionId } = {},
  eventName,
  params,
  { fetchImpl = fetch } = {},
) {
  if (!config.ga4MeasurementId && !config.ga4ApiSecret) return false;
  if (!config.ga4MeasurementId || !config.ga4ApiSecret) {
    logDeliveryIssue("incomplete_configuration");
    return false;
  }
  if (!CLIENT_ID_PATTERN.test(clientId || "")) {
    logDeliveryIssue("missing_or_invalid_client_id");
    return false;
  }
  if (!EVENT_NAME_PATTERN.test(eventName || "")) {
    throw new TypeError(
      "GA4 event names must use lowercase letters and underscores.",
    );
  }

  const query = new URLSearchParams({
    measurement_id: config.ga4MeasurementId,
    api_secret: config.ga4ApiSecret,
  });
  const eventParams = { ...params };
  if (/^\d{1,16}$/.test(sessionId || "")) {
    const numericSessionId = Number(sessionId);
    if (Number.isSafeInteger(numericSessionId)) {
      eventParams.session_id = numericSessionId;
    }
  }

  try {
    const response = await fetchImpl(`${MEASUREMENT_PROTOCOL_URL}?${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        events: [{ name: eventName, params: eventParams }],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      logDeliveryIssue("http_error", { statusCode: response.status });
      return false;
    }
    return true;
  } catch (error) {
    logDeliveryIssue("request_failed", {
      errorType: error?.name || "Error",
    });
    return false;
  }
}

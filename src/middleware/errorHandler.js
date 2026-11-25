export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  let status = error.status || error.statusCode || 500;
  let code = error.code || "INTERNAL_SERVER_ERROR";
  let message = error.message || "An unexpected error occurred.";

  if (error.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "Request body contains invalid JSON.";
  } else if (error.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Request body exceeds the 20kb limit.";
  } else if (status >= 500) {
    if (!(error instanceof ApiError)) {
      status = 500;
      code = "INTERNAL_SERVER_ERROR";
      message = "An unexpected error occurred.";
    }
    console.error(
      JSON.stringify({
        event: "api_5xx",
        requestId: request.requestId,
        method: request.method,
        route: request.route?.path || request.path,
        status,
        errorCode: code,
        errorType: error.name,
      }),
    );
  }

  response.status(status).json({ error: { code, message } });
}

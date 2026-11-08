export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(error, _request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  let status = error.status || error.statusCode || 500;
  let code = error.code || "INTERNAL_SERVER_ERROR";
  let message = error.message || "An unexpected error occurred.";

  if (error.code === 11000) {
    status = 409;
    code = "CONFLICT";
    message = "A customer with this email already exists.";
  } else if (error.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "Request body contains invalid JSON.";
  } else if (error.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Request body exceeds the 20kb limit.";
  } else if (status >= 500) {
    status = 500;
    code = "INTERNAL_SERVER_ERROR";
    message = "An unexpected error occurred.";
    console.error("API request failed:", error);
  }

  response.status(status).json({ error: { code, message } });
}

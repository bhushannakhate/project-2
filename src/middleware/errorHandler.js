export function errorHandler(error, _request, response, _next) {
  if (response.headersSent) return;

  if (error.code === 11000) {
    response.status(409).json({
      error: {
        code: "CONFLICT",
        message: "A customer with this email already exists.",
      },
    });
    return;
  }

  if (error.type === "entity.too.large") {
    response.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the 20kb limit.",
      },
    });
    return;
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    response.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body must contain valid JSON.",
      },
    });
    return;
  }

  if (error.message === "Origin is not allowed by CORS.") {
    response.status(403).json({
      error: {
        code: "CORS_ORIGIN_DENIED",
        message: "Request origin is not allowed.",
      },
    });
    return;
  }

  console.error("Unhandled API error:", error);
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
}

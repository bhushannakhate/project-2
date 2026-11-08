export function notFound(request, response) {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${request.method} ${request.originalUrl}`,
    },
  });
}

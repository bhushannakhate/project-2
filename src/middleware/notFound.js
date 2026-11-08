import { ApiError } from "./errorHandler.js";

export function notFound(request, _response, next) {
  next(
    new ApiError(
      404,
      "NOT_FOUND",
      `Route not found: ${request.method} ${request.originalUrl}`,
    ),
  );
}

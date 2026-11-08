import { ApiError } from "./errorHandler.js";

export function validateBody(request, _response, next) {
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  ) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "Provide request details as a JSON object.",
      ),
    );
    return;
  }

  next();
}

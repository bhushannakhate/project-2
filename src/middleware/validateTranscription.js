import { ApiError } from "./errorHandler.js";

const MAX_TRANSCRIPT_LENGTH = 4000;

export function validateTranscriptionEdit(request, _response, next) {
  const body = request.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "transcript") ||
    typeof body.transcript !== "string" ||
    !body.transcript.trim() ||
    body.transcript.length > MAX_TRANSCRIPT_LENGTH
  ) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        `transcript must be non-empty text no longer than ${MAX_TRANSCRIPT_LENGTH} characters.`,
      ),
    );
    return;
  }
  next();
}

export function validateTranscriptionRequest(request, _response, next) {
  const body = request.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length > 0
  ) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "The transcription request body must be empty.",
      ),
    );
    return;
  }
  next();
}

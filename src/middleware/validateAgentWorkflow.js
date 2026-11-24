import { ApiError } from "./errorHandler.js";

const MAX_INSTRUCTIONS_LENGTH = 2000;

export function validateAgentWorkflow(request, _response, next) {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "Provide workflow instructions as a JSON object.",
      ),
    );
    return;
  }

  const allowedFields = new Set(["instructions", "includeAudio"]);
  const unexpected = Object.keys(body).find((key) => !allowedFields.has(key));
  if (unexpected) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        `Field "${unexpected}" is not allowed.`,
      ),
    );
    return;
  }

  if (
    Object.hasOwn(body, "instructions") &&
    (typeof body.instructions !== "string" ||
      body.instructions.length > MAX_INSTRUCTIONS_LENGTH)
  ) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        `instructions must be text no longer than ${MAX_INSTRUCTIONS_LENGTH} characters.`,
      ),
    );
    return;
  }

  if (
    Object.hasOwn(body, "includeAudio") &&
    typeof body.includeAudio !== "boolean"
  ) {
    next(
      new ApiError(400, "VALIDATION_ERROR", "includeAudio must be a boolean."),
    );
    return;
  }

  request.agentInstructions = body.instructions?.trim() || "";
  request.agentIncludeAudio = body.includeAudio;
  if (body.includeAudio === false && !request.agentInstructions) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "Enter written instructions or add an audio recording.",
      ),
    );
    return;
  }
  next();
}

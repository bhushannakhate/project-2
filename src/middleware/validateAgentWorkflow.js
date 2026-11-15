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

  const unexpected = Object.keys(body).find((key) => key !== "instructions");
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

  request.agentInstructions = body.instructions?.trim() || "";
  next();
}

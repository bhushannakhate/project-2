import { ApiError } from "./errorHandler.js";

const MAX_INSTRUCTIONS_LENGTH = 2000;
const UNSAFE_INSTRUCTION_PATTERN =
  /(ignore\s+(all|any|the|previous)\s+instructions|reveal\s+the\s+system\s+prompt|developer\s+message|system\s*prompt)/i;

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

  const allowedFields = new Set([
    "instructions",
    "includeAudio",
    "transcript",
    "consentToGemini",
  ]);
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
    Object.hasOwn(body, "instructions") &&
    UNSAFE_INSTRUCTION_PATTERN.test(body.instructions)
  ) {
    next(
      new ApiError(
        400,
        "UNSAFE_INSTRUCTIONS",
        "Remove system or developer override language from the editing instruction.",
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

  if (
    Object.hasOwn(body, "transcript") &&
    (typeof body.transcript !== "string" || body.transcript.length > 4000)
  ) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "transcript must be text no longer than 4000 characters.",
      ),
    );
    return;
  }

  if (body.consentToGemini !== true) {
    next(
      new ApiError(
        400,
        "GEMINI_CONSENT_REQUIRED",
        "Confirm that the selected image and instructions may be sent to Gemini for this edit.",
      ),
    );
    return;
  }

  request.agentInstructions = body.instructions?.trim() || "";
  request.agentIncludeAudio = body.includeAudio;
  request.agentTranscript = body.transcript?.trim() || "";
  request.agentGeminiConsent = true;
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

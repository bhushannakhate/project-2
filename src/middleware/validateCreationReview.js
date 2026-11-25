import { ApiError } from "./errorHandler.js";

const MAX_REVISION_INSTRUCTION_LENGTH = 1000;
const UNSAFE_INSTRUCTION_PATTERN =
  /(ignore\s+(all|any|the|previous)\s+instructions|reveal\s+the\s+system\s+prompt|developer\s+message|system\s*prompt)/i;

export function validateCreationReview(request, _response, next) {
  const body = request.body;
  const allowedFields = new Set(["action", "instruction"]);
  const unexpected = Object.keys(body || {}).find(
    (key) => !allowedFields.has(key),
  );
  const instruction = body?.instruction?.trim() || "";

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    unexpected ||
    !["approve", "reject", "request_revision"].includes(body.action)
  ) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        'action must be "approve", "reject", or "request_revision".',
      ),
    );
    return;
  }

  if (
    body.action === "request_revision" &&
    (!instruction || instruction.length > MAX_REVISION_INSTRUCTION_LENGTH)
  ) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        `instruction must be non-empty text no longer than ${MAX_REVISION_INSTRUCTION_LENGTH} characters.`,
      ),
    );
    return;
  }

  if (instruction && UNSAFE_INSTRUCTION_PATTERN.test(instruction)) {
    next(
      new ApiError(
        400,
        "UNSAFE_INSTRUCTIONS",
        "Remove system or developer override language from the revision instruction.",
      ),
    );
    return;
  }

  request.reviewAction = body.action;
  request.reviewInstruction = instruction;
  next();
}

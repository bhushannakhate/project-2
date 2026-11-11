const CREATION_STATUSES = new Set([
  "draft",
  "processing",
  "completed",
  "failed",
]);
const CREATION_FIELDS = new Set([
  "sourceImageUrl",
  "outputImageUrl",
  "instructions",
  "audioUrl",
  "status",
  "metadata",
  "pinterest",
]);
const MAX_URL_LENGTH = 2048;
const MAX_INSTRUCTIONS_LENGTH = 2000;
const MAX_OBJECT_BYTES = 4096;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validUrl(value) {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validObject(value) {
  return (
    isPlainObject(value) &&
    Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_OBJECT_BYTES
  );
}

export function validateCreation(input, { partial = false } = {}) {
  const keys = Object.keys(input);
  const unexpected = keys.find((key) => !CREATION_FIELDS.has(key));
  if (unexpected) {
    return { error: `Field "${unexpected}" is not allowed.` };
  }

  if (partial && keys.length === 0) {
    return { error: "Provide at least one field to update." };
  }

  for (const field of ["sourceImageUrl", "outputImageUrl", "audioUrl"]) {
    if (Object.hasOwn(input, field) && !validUrl(input[field])) {
      return { error: `${field} must be a valid HTTP or HTTPS URL.` };
    }
  }

  if (
    Object.hasOwn(input, "instructions") &&
    (typeof input.instructions !== "string" ||
      input.instructions.length > MAX_INSTRUCTIONS_LENGTH)
  ) {
    return {
      error: `instructions must be text no longer than ${MAX_INSTRUCTIONS_LENGTH} characters.`,
    };
  }

  if (Object.hasOwn(input, "status") && !CREATION_STATUSES.has(input.status)) {
    return {
      error: `status must be one of: ${[...CREATION_STATUSES].join(", ")}.`,
    };
  }

  for (const field of ["metadata", "pinterest"]) {
    if (Object.hasOwn(input, field) && !validObject(input[field])) {
      return {
        error: `${field} must be a JSON object no larger than ${MAX_OBJECT_BYTES} bytes.`,
      };
    }
  }

  return { creation: { ...input } };
}

export function validateCreationListQuery(query) {
  let limit = 20;
  if (Object.hasOwn(query, "limit")) {
    if (
      typeof query.limit !== "string" ||
      !/^[1-9]\d*$/.test(query.limit) ||
      Number(query.limit) > 100
    ) {
      return { error: "limit must be an integer between 1 and 100." };
    }
    limit = Number(query.limit);
  }

  if (
    Object.hasOwn(query, "status") &&
    (typeof query.status !== "string" || !CREATION_STATUSES.has(query.status))
  ) {
    return {
      error: `status must be one of: ${[...CREATION_STATUSES].join(", ")}.`,
    };
  }

  if (
    Object.hasOwn(query, "cursor") &&
    (typeof query.cursor !== "string" ||
      query.cursor.length === 0 ||
      query.cursor.length > 1500 ||
      query.cursor.includes("/"))
  ) {
    return { error: "cursor is invalid." };
  }

  const allowedQueryFields = new Set(["limit", "status", "cursor"]);
  const unexpected = Object.keys(query).find(
    (key) => !allowedQueryFields.has(key),
  );
  if (unexpected) {
    return { error: `Query parameter "${unexpected}" is not supported.` };
  }

  return {
    query: {
      limit,
      status: query.status,
      cursor: query.cursor,
    },
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCreation,
  validateCreationListQuery,
} from "../src/models/creationValidation.js";

test("creation validation accepts media-free creations and supported fields", () => {
  assert.deepEqual(validateCreation({}), { creation: {} });
  assert.deepEqual(
    validateCreation({
      sourceImageUrl: "https://storage.example/image.png",
      instructions: "Make the background blue.",
      status: "draft",
      metadata: { width: 1200 },
    }),
    {
      creation: {
        sourceImageUrl: "https://storage.example/image.png",
        instructions: "Make the background blue.",
        status: "draft",
        metadata: { width: 1200 },
      },
    },
  );
});

test("creation validation rejects protected fields and malformed values", () => {
  assert.match(
    validateCreation({
      sourceImageUrl: "https://storage.example/image.png",
      userId: "another-user",
    }).error,
    /not allowed/,
  );
  assert.match(
    validateCreation({ sourceImageUrl: "javascript:alert(1)" }).error,
    /HTTP or HTTPS/,
  );
  assert.match(
    validateCreation({
      sourceImageUrl: "https://storage.example/image.png",
      status: "unrecognized",
    }).error,
    /status must be one of/,
  );
  assert.match(
    validateCreation({
      sourceImageUrl: "https://storage.example/image.png",
      instructions: "x".repeat(2001),
    }).error,
    /no longer than 2000 characters/,
  );
  assert.match(
    validateCreation({
      sourceImageUrl: "https://storage.example/image.png",
      metadata: { description: "x".repeat(4096) },
    }).error,
    /no larger than 4096 bytes/,
  );
  assert.deepEqual(
    validateCreation({ instructions: "change" }, { partial: true }),
    { creation: { instructions: "change" } },
  );
  assert.match(
    validateCreation({}, { partial: true }).error,
    /at least one field/,
  );
});

test("creation list query validates limits, filters, and cursors", () => {
  assert.deepEqual(
    validateCreationListQuery({ limit: "10", status: "draft" }),
    {
      query: { limit: 10, status: "draft", cursor: undefined },
    },
  );
  assert.equal(
    validateCreationListQuery({ limit: "0" }).error,
    "limit must be an integer between 1 and 100.",
  );
  assert.equal(
    validateCreationListQuery({ limit: "101" }).error,
    "limit must be an integer between 1 and 100.",
  );
  assert.match(
    validateCreationListQuery({ status: "unknown" }).error,
    /status must be one of/,
  );
  assert.equal(
    validateCreationListQuery({ cursor: "bad/id" }).error,
    "cursor is invalid.",
  );
  assert.equal(
    validateCreationListQuery({ unknown: "value" }).error,
    'Query parameter "unknown" is not supported.',
  );
});

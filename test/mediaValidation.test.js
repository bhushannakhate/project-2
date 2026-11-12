import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_FORMATS_BY_CONTENT_TYPE,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  validateMediaUpload,
} from "../src/models/mediaValidation.js";

test("media upload validation accepts supported image and audio types", () => {
  assert.deepEqual(
    validateMediaUpload(
      { contentType: "image/png", sizeBytes: 1024 },
      "sourceImage",
    ),
    { upload: { contentType: "image/png", sizeBytes: 1024 } },
  );
  assert.deepEqual(
    validateMediaUpload(
      { contentType: "audio/webm", sizeBytes: 1024 },
      "audio",
    ),
    { upload: { contentType: "audio/webm", sizeBytes: 1024 } },
  );
});

test("media upload validation rejects unsupported types, sizes, and fields", () => {
  assert.match(
    validateMediaUpload(
      { contentType: "audio/webm", sizeBytes: 10 },
      "sourceImage",
    ).error,
    /not supported/,
  );
  assert.match(
    validateMediaUpload(
      { contentType: "image/png", sizeBytes: 10 * 1024 * 1024 + 1 },
      "outputImage",
    ).error,
    /sizeBytes/,
  );
  assert.match(
    validateMediaUpload(
      { contentType: "image/png", sizeBytes: 10, path: "other-user/file" },
      "sourceImage",
    ).error,
    /not allowed/,
  );
  assert.match(
    validateMediaUpload(
      { contentType: "image/png", sizeBytes: 1 },
      "unexpected",
    ).error,
    /mediaKind/,
  );
});

test("source image policy is explicit and bounded", () => {
  assert.deepEqual(IMAGE_FORMATS_BY_CONTENT_TYPE, {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  });
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_IMAGE_DIMENSION, 10_000);
  assert.equal(MAX_IMAGE_PIXELS, 40_000_000);
});

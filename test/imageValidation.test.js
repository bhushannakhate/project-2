import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  InvalidImageError,
  normalizeImageBuffer,
} from "../src/models/imageValidation.js";

async function createImage(format, options = {}) {
  let image = sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: "#ad5a4d",
    },
  });
  if (format === "jpeg") {
    image = image.withExif({ IFD0: { Artist: "test-user" } });
  }
  return image[format](options).toBuffer();
}

test("image validation decodes and normalizes supported formats", async () => {
  for (const [format, contentType] of [
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ]) {
    const input = await createImage(format);
    const result = await normalizeImageBuffer(input, contentType);
    const metadata = await sharp(result.buffer).metadata();

    assert.equal(result.contentType, contentType);
    assert.equal(result.width, 4);
    assert.equal(result.height, 3);
    assert.equal(result.sizeBytes, result.buffer.length);
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 4);
    assert.equal(metadata.height, 3);
    assert.equal(metadata.exif, undefined);
  }
});

test("image validation rejects empty, corrupt, and mismatched image bytes", async () => {
  await assert.rejects(
    normalizeImageBuffer(Buffer.alloc(0), "image/png"),
    InvalidImageError,
  );
  await assert.rejects(
    normalizeImageBuffer(Buffer.from("not an image"), "image/png"),
    InvalidImageError,
  );
  await assert.rejects(
    normalizeImageBuffer(await createImage("jpeg"), "image/png"),
    /do not match/,
  );
  await assert.rejects(
    normalizeImageBuffer(await createImage("png"), "image/gif"),
    /not supported/,
  );
});

test("image validation rejects excessive dimensions and pixel counts before decoding", async () => {
  const oversized = await createImage("png");
  oversized.writeUInt32BE(10_001, 16);
  const excessivePixels = await createImage("png");
  excessivePixels.writeUInt32BE(8_000, 16);
  excessivePixels.writeUInt32BE(5_001, 20);

  await assert.rejects(
    normalizeImageBuffer(oversized, "image/png"),
    /dimensions/,
  );
  await assert.rejects(
    normalizeImageBuffer(excessivePixels, "image/png"),
    /dimensions/,
  );
});

test("image validation rejects oversized byte buffers", async () => {
  const pngImage = await sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: "#ad5a4d",
    },
  })
    .webp()
    .toBuffer();
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);

  await assert.rejects(
    normalizeImageBuffer(oversized, "image/png"),
    /must not exceed/,
  );
  await assert.rejects(
    normalizeImageBuffer(pngImage, "image/jpeg"),
    /do not match/,
  );
});

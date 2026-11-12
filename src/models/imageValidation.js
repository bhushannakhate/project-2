import sharp from "sharp";
import {
  IMAGE_FORMATS_BY_CONTENT_TYPE,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
} from "./mediaValidation.js";

const ENCODER_OPTIONS = {
  jpeg: { quality: 90, mozjpeg: true },
  png: { compressionLevel: 9 },
  webp: { quality: 90 },
};

export class InvalidImageError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidImageError";
  }
}

function assertImageDimensions(width, height) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new InvalidImageError(
      `Image dimensions must not exceed ${MAX_IMAGE_DIMENSION} pixels per side or ${MAX_IMAGE_PIXELS} total pixels.`,
    );
  }
}

export async function normalizeImageBuffer(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1) {
    throw new InvalidImageError("Image data is empty or invalid.");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new InvalidImageError(
      `Image must not exceed ${MAX_IMAGE_BYTES} bytes.`,
    );
  }

  const expectedFormat = IMAGE_FORMATS_BY_CONTENT_TYPE[contentType];
  if (!expectedFormat) {
    throw new InvalidImageError("Image content type is not supported.");
  }

  let metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION,
      sequentialRead: true,
    }).metadata();
  } catch {
    throw new InvalidImageError("Image data is corrupt or unsupported.");
  }

  if (metadata.format !== expectedFormat) {
    throw new InvalidImageError(
      "Image bytes do not match the declared content type.",
    );
  }
  if (metadata.pages && metadata.pages > 1) {
    throw new InvalidImageError(
      "Animated or multi-page images are not supported.",
    );
  }
  assertImageDimensions(metadata.width, metadata.height);

  let normalized;
  try {
    normalized = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .toFormat(expectedFormat, ENCODER_OPTIONS[expectedFormat])
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new InvalidImageError("Image data could not be safely decoded.");
  }

  assertImageDimensions(normalized.info.width, normalized.info.height);
  if (normalized.data.length > MAX_IMAGE_BYTES) {
    throw new InvalidImageError(
      `Validated image must not exceed ${MAX_IMAGE_BYTES} bytes.`,
    );
  }

  return {
    buffer: normalized.data,
    contentType,
    sizeBytes: normalized.data.length,
    width: normalized.info.width,
    height: normalized.info.height,
  };
}

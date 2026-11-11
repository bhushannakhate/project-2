export const MEDIA_KINDS = new Set(["sourceImage", "outputImage", "audio"]);

const CONTENT_TYPES_BY_KIND = {
  sourceImage: new Set(["image/jpeg", "image/png", "image/webp"]),
  outputImage: new Set(["image/jpeg", "image/png", "image/webp"]),
  audio: new Set([
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
  ]),
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function validateMediaUpload(input, mediaKind) {
  if (!MEDIA_KINDS.has(mediaKind)) {
    return { error: "mediaKind must be sourceImage, outputImage, or audio." };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Request body must be a JSON object." };
  }

  const unexpected = Object.keys(input).find(
    (key) => !["contentType", "sizeBytes"].includes(key),
  );
  if (unexpected) {
    return { error: `Field "${unexpected}" is not allowed.` };
  }

  if (!CONTENT_TYPES_BY_KIND[mediaKind].has(input.contentType)) {
    return {
      error: `contentType is not supported for ${mediaKind}.`,
    };
  }

  const maximumBytes =
    mediaKind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > maximumBytes
  ) {
    return {
      error: `sizeBytes must be an integer between 1 and ${maximumBytes}.`,
    };
  }

  return {
    upload: {
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    },
  };
}

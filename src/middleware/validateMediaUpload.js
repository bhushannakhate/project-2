import {
  MEDIA_KINDS,
  validateMediaUpload as parseMediaUpload,
} from "../models/mediaValidation.js";
import { ApiError } from "./errorHandler.js";

export function validateMediaUpload(request, _response, next) {
  const result = parseMediaUpload(request.body, request.params.mediaKind);
  if (result.error) {
    next(new ApiError(400, "VALIDATION_ERROR", result.error));
    return;
  }

  request.mediaUpload = result.upload;
  next();
}

export function validateMediaKind(request, _response, next) {
  if (!MEDIA_KINDS.has(request.params.mediaKind)) {
    next(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "mediaKind must be sourceImage, outputImage, or audio.",
      ),
    );
    return;
  }

  next();
}

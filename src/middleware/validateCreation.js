import {
  validateCreation as parseCreation,
  validateCreationListQuery,
} from "../models/creationValidation.js";
import { ApiError } from "./errorHandler.js";

export function validateCreation({ partial = false } = {}) {
  return (request, _response, next) => {
    const result = parseCreation(request.body, { partial });
    if (result.error) {
      next(new ApiError(400, "VALIDATION_ERROR", result.error));
      return;
    }

    request.creation = result.creation;
    next();
  };
}

export function validateCreationQuery(request, _response, next) {
  const result = validateCreationListQuery(request.query);
  if (result.error) {
    next(new ApiError(400, "VALIDATION_ERROR", result.error));
    return;
  }

  request.creationQuery = result.query;
  next();
}

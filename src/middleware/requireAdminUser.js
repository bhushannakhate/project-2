import { asyncHandler } from "./asyncHandler.js";
import { ApiError } from "./errorHandler.js";
import { isAdminUser } from "../services/adminAccessService.js";

export function createRequireAdminUser(adminEmails) {
  return asyncHandler(async (request, _response, next) => {
    if (!isAdminUser(request.firebaseUser, adminEmails)) {
      throw new ApiError(403, "FORBIDDEN", "Administrator access is required.");
    }
    next();
  });
}

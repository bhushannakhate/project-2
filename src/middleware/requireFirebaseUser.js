import { getFirebase } from "../config/firebase.js";
import { asyncHandler } from "./asyncHandler.js";
import { ApiError } from "./errorHandler.js";

export const requireFirebaseUser = asyncHandler(
  async (request, _response, next) => {
    const authorization = request.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError(
        401,
        "UNAUTHENTICATED",
        "A Firebase bearer token is required.",
      );
    }

    const { auth } = getFirebase();
    try {
      request.firebaseUser = await auth.verifyIdToken(authorization.slice(7));
    } catch {
      throw new ApiError(
        401,
        "UNAUTHENTICATED",
        "The Firebase identity token is invalid or expired.",
      );
    }
    next();
  },
);

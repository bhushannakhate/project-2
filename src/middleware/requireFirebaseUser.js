import { getFirebase } from "../config/firebase.js";
import { asyncHandler } from "./asyncHandler.js";
import { ApiError } from "./errorHandler.js";

const unauthenticated = () =>
  new ApiError(
    401,
    "UNAUTHENTICATED",
    "A valid Firebase bearer token is required.",
  );

export function createRequireFirebaseUser(getAuth = () => getFirebase().auth) {
  return asyncHandler(async (request, _response, next) => {
    const authorization = request.header("authorization");
    const match = /^Bearer\s+(\S+)$/i.exec(authorization || "");
    if (!match) {
      throw unauthenticated();
    }

    const auth = getAuth();
    try {
      const decodedToken = await auth.verifyIdToken(match[1], true);
      request.firebaseUser = decodedToken;
      request.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified,
        name: decodedToken.name,
        picture: decodedToken.picture,
      };
    } catch {
      throw unauthenticated();
    }
    next();
  });
}

export const requireFirebaseUser = createRequireFirebaseUser();

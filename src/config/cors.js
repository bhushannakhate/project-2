import cors from "cors";
import { ApiError } from "../middleware/errorHandler.js";

export function createCorsMiddleware(allowedOrigins) {
  return cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(
        new ApiError(
          403,
          "CORS_ORIGIN_DENIED",
          "This website origin is not allowed by the API.",
        ),
      );
    },
  });
}

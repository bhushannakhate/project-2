import { config } from "./env.js";

export const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.webOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin is not allowed by CORS."));
  },
};

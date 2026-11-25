import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createCorsMiddleware } from "./config/cors.js";
import { loadConfig } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { asyncHandler } from "./middleware/asyncHandler.js";
import { getGooglePhotosOAuthCallback } from "./controllers/firestoreController.js";
import firestoreRoutes from "./routes/firestoreRoutes.js";
import { createAgentWorkflowRoutes } from "./routes/agentWorkflowRoutes.js";
import { requestId } from "./middleware/requestId.js";

export function createApp({
  config = loadConfig(),
  frontendDirectory = resolve(process.cwd(), "public"),
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'", "https://www.googletagmanager.com"],
          "connect-src": [
            "'self'",
            "https://identitytoolkit.googleapis.com",
            "https://securetoken.googleapis.com",
            "https://www.googleapis.com",
            "https://storage.googleapis.com",
            "https://www.google-analytics.com",
            "https://analytics.google.com",
            "https://region1.google-analytics.com",
          ],
          "img-src": [
            "'self'",
            "data:",
            "blob:",
            "https://storage.googleapis.com",
          ],
          "frame-src": [
            "'self'",
            "https://project-2-pinboard-2026.firebaseapp.com",
            "https://accounts.google.com",
          ],
        },
      },
    }),
  );
  morgan.token("request-id", (request) => request.requestId || "-");
  app.use(
    morgan(
      config.nodeEnv === "production"
        ? ':remote-addr - :method :url :status :res[content-length] ":referrer" ":user-agent" request_id=:request-id'
        : "dev",
      {
        skip: (request) => request.path === "/api/google-photos/oauth/callback",
      },
    ),
  );
  app.use(createCorsMiddleware(config.allowedOrigins));
  app.use(express.json({ limit: "20kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.get(
    "/api/google-photos/oauth/callback",
    asyncHandler(getGooglePhotosOAuthCallback),
  );
  app.use("/api", createAgentWorkflowRoutes(config));
  app.use("/api", firestoreRoutes);
  const frontendIndex = resolve(frontendDirectory, "index.html");
  if (existsSync(frontendIndex)) {
    app.use(express.static(frontendDirectory, { index: false }));
    app.use((request, response, next) => {
      if (
        (request.method !== "GET" && request.method !== "HEAD") ||
        request.path === "/api" ||
        request.path.startsWith("/api/") ||
        !request.accepts("html")
      ) {
        return next();
      }

      response.sendFile(frontendIndex, (error) => {
        if (error) next(error);
      });
    });
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

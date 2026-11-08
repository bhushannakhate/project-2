import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createCorsMiddleware } from "./config/cors.js";
import { loadConfig } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { createDemoCustomerRoutes } from "./routes/demoCustomerRoutes.js";
import firestoreRoutes from "./routes/firestoreRoutes.js";

export function createApp({ config = loadConfig(), customerCollection } = {}) {
  if (config.demoCustomersEnabled && !customerCollection) {
    throw new Error(
      "A MongoDB customer collection is required when demo customers are enabled.",
    );
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));
  app.use(createCorsMiddleware(config.allowedOrigins));
  app.use(express.json({ limit: "20kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use("/api", firestoreRoutes);
  if (config.demoCustomersEnabled) {
    app.use(
      "/api/demo/customers",
      createDemoCustomerRoutes(customerCollection),
    );
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

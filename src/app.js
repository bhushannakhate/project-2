import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config/env.js";
import { corsOptions } from "./config/cors.js";
import { createCustomerService } from "./services/customerService.js";
import { createDemoCustomerRoutes } from "./routes/demoCustomerRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";

export function createApp({ customerModel } = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));
  app.use(express.json({ limit: "20kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  if (config.demoCustomersEnabled && customerModel) {
    const customerService = createCustomerService(customerModel);
    app.use("/api/demo/customers", createDemoCustomerRoutes(customerService));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

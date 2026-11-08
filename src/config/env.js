import "dotenv/config";

function parsePort(value) {
  const port = Number(value ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function parseBoolean(name, value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be "true" or "false".`);
}

const demoCustomersEnabled = parseBoolean(
  "DEMO_CUSTOMERS_ENABLED",
  process.env.DEMO_CUSTOMERS_ENABLED,
);

if (demoCustomersEnabled && !process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required when DEMO_CUSTOMERS_ENABLED=true.");
}

export const config = Object.freeze({
  port: parsePort(process.env.PORT),
  nodeEnv: process.env.NODE_ENV ?? "development",
  webOrigins: (
    process.env.WEB_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  demoCustomersEnabled,
  mongodbUri: process.env.MONGODB_URI,
  mongodbDatabase: process.env.MONGODB_DATABASE ?? "project2",
});

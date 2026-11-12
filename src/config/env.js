import "dotenv/config";

const DEFAULT_WEB_ORIGINS =
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,https://project-2-pinboard-2026.web.app,https://project-2-pinboard-2026.firebaseapp.com";

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const nodeEnv = env.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }

  const allowedOrigins = (env.WEB_ORIGIN || DEFAULT_WEB_ORIGINS)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0) {
    throw new Error("WEB_ORIGIN must contain at least one allowed origin.");
  }

  const demoCustomersEnabled = parseBoolean(
    env.DEMO_CUSTOMERS_ENABLED,
    "DEMO_CUSTOMERS_ENABLED",
  );
  const mongodbUri = env.MONGODB_URI || "";
  if (demoCustomersEnabled && !mongodbUri) {
    throw new Error(
      "MONGODB_URI is required when DEMO_CUSTOMERS_ENABLED=true.",
    );
  }

  const firebaseCredentialProfile = (
    env.FIREBASE_CREDENTIAL_PROFILE || "bhushan"
  ).toLowerCase();
  if (!["bhushan", "ryan"].includes(firebaseCredentialProfile)) {
    throw new Error(
      "FIREBASE_CREDENTIAL_PROFILE must be either bhushan or ryan.",
    );
  }

  const adminEmails = (env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return {
    port,
    nodeEnv,
    allowedOrigins,
    demoCustomersEnabled,
    mongodbUri,
    mongodbDatabase: env.MONGODB_DATABASE || "project2",
    firebaseProjectId: env.FIREBASE_PROJECT_ID || "",
    mediaStorageBucket: env.MEDIA_STORAGE_BUCKET || "",
    firebaseCredentialProfile,
    adminEmails,
    firebaseCredentialsBhushan: env.FIREBASE_CREDENTIALS_BHUSHAN || "",
    firebaseCredentialsRyan: env.FIREBASE_CREDENTIALS_RYAN || "",
    googleApplicationCredentials: env.GOOGLE_APPLICATION_CREDENTIALS || "",
    firebaseAuthEmulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST || "",
    googlePhotosClientId: env.GOOGLE_PHOTOS_CLIENT_ID || "",
    googlePhotosClientSecret: env.GOOGLE_PHOTOS_CLIENT_SECRET || "",
    googlePhotosRedirectUri: env.GOOGLE_PHOTOS_REDIRECT_URI || "",
    googlePhotosTokenEncryptionKey:
      env.GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY || "",
  };
}

function parseBoolean(value, name) {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config/env.js";

test("loads defaults without requiring MongoDB for normal startup", () => {
  const config = loadConfig({});

  assert.equal(config.port, 4000);
  assert.equal(config.demoCustomersEnabled, false);
  assert.equal(config.googlePhotosClientId, "");
  assert.equal(config.googlePhotosClientSecret, "");
  assert.deepEqual(config.allowedOrigins, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "https://project-2-pinboard-2026.web.app",
    "https://project-2-pinboard-2026.firebaseapp.com",
  ]);
});

test("loads Google Photos OAuth settings without exposing them in defaults", () => {
  const config = loadConfig({
    GOOGLE_PHOTOS_CLIENT_ID: "client-id",
    GOOGLE_PHOTOS_CLIENT_SECRET: "client-secret",
    GOOGLE_PHOTOS_REDIRECT_URI:
      "http://localhost:4000/api/google-photos/oauth/callback",
    GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY: "base64-key",
  });

  assert.equal(config.googlePhotosClientId, "client-id");
  assert.equal(config.googlePhotosClientSecret, "client-secret");
  assert.equal(
    config.googlePhotosRedirectUri,
    "http://localhost:4000/api/google-photos/oauth/callback",
  );
  assert.equal(config.googlePhotosTokenEncryptionKey, "base64-key");
});

test("requires MongoDB configuration only when demo routes are enabled", () => {
  assert.throws(
    () => loadConfig({ DEMO_CUSTOMERS_ENABLED: "true" }),
    /MONGODB_URI is required/,
  );
  assert.equal(
    loadConfig({
      DEMO_CUSTOMERS_ENABLED: "true",
      MONGODB_URI: "mongodb://localhost:27017",
    }).demoCustomersEnabled,
    true,
  );
});

test("validates the port, environment, and boolean settings", () => {
  assert.throws(() => loadConfig({ PORT: "0" }), /PORT must be an integer/);
  assert.throws(
    () => loadConfig({ NODE_ENV: "staging" }),
    /NODE_ENV must be development, test, or production/,
  );
  assert.throws(
    () => loadConfig({ DEMO_CUSTOMERS_ENABLED: "yes" }),
    /DEMO_CUSTOMERS_ENABLED must be true or false/,
  );
});

test("validates the Firebase credential profile", () => {
  assert.throws(
    () => loadConfig({ FIREBASE_CREDENTIAL_PROFILE: "unknown" }),
    /FIREBASE_CREDENTIAL_PROFILE must be either bhushan or ryan/,
  );
});

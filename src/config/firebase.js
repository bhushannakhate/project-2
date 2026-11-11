import fs from "node:fs";
import path from "node:path";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { loadConfig } from "./env.js";

function resolveCredential(config) {
  const profileCredential =
    config.firebaseCredentialProfile === "ryan"
      ? config.firebaseCredentialsRyan
      : config.firebaseCredentialsBhushan;
  const credentialPath =
    config.googleApplicationCredentials || profileCredential;

  if (!credentialPath) return applicationDefault();

  const resolvedPath = path.resolve(process.cwd(), credentialPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Firebase service-account file was not found: ${resolvedPath}. Configure GOOGLE_APPLICATION_CREDENTIALS or the selected profile credential.`,
    );
  }

  return cert(JSON.parse(fs.readFileSync(resolvedPath, "utf8")));
}

export function getFirebase(config = loadConfig()) {
  if (!config.mediaStorageBucket) {
    throw new Error(
      "Set MEDIA_STORAGE_BUCKET before using authenticated Firebase routes.",
    );
  }

  if (getApps().length === 0) {
    const credential = config.firebaseAuthEmulatorHost
      ? applicationDefault()
      : resolveCredential(config);
    const projectId = config.firebaseProjectId || credential.projectId;
    if (!projectId) {
      throw new Error(
        "Set FIREBASE_PROJECT_ID before using authenticated Firestore routes.",
      );
    }

    initializeApp({
      credential,
      projectId,
      storageBucket: config.mediaStorageBucket,
    });
  }

  return {
    auth: getAuth(),
    firestore: getFirestore(),
    bucket: getStorage().bucket(config.mediaStorageBucket),
  };
}

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  applicationDefault,
  cert,
  initializeApp,
  getApps,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function resolveCredential(profile) {
  const profileCredential =
    process.env[
      profile === "ryan"
        ? "FIREBASE_CREDENTIALS_RYAN"
        : "FIREBASE_CREDENTIALS_BHUSHAN"
    ];
  const credentialPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || profileCredential;

  if (!credentialPath) return applicationDefault();

  const resolvedPath = path.resolve(process.cwd(), credentialPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Firebase service-account file was not found: ${resolvedPath}. Configure GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_CREDENTIALS_${profile.toUpperCase()}.`,
    );
  }

  return cert(JSON.parse(fs.readFileSync(resolvedPath, "utf8")));
}

export function getFirebase() {
  if (getApps().length === 0) {
    const profile = (
      process.env.FIREBASE_CREDENTIAL_PROFILE || "bhushan"
    ).toLowerCase();
    const credential = process.env.FIREBASE_AUTH_EMULATOR_HOST
      ? applicationDefault()
      : resolveCredential(profile);

    initializeApp({
      credential,
      projectId: process.env.FIREBASE_PROJECT_ID || credential.projectId,
    });
  }

  return { auth: getAuth(), firestore: getFirestore() };
}

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import "dotenv/config";

const projectId = process.env.FIREBASE_PROJECT_ID;
const profile = (
  process.env.FIREBASE_CREDENTIAL_PROFILE || "bhushan"
).toLowerCase();

if (!projectId || projectId.includes("your-")) {
  throw new Error("Set FIREBASE_PROJECT_ID in .env.");
}

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const credentialPath = path.resolve(
    process.cwd(),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  );
  if (!fs.existsSync(credentialPath)) {
    throw new Error(
      `Production credential file was not found: ${credentialPath}`,
    );
  }
  console.log(
    `Firebase configuration is ready for project ${projectId} using Google Application Credentials.`,
  );
  process.exit(0);
}

if (!["bhushan", "ryan"].includes(profile)) {
  throw new Error(
    "FIREBASE_CREDENTIAL_PROFILE must be either bhushan or ryan.",
  );
}

const credentialVariable =
  profile === "ryan"
    ? "FIREBASE_CREDENTIALS_RYAN"
    : "FIREBASE_CREDENTIALS_BHUSHAN";
const credentialPath = process.env[credentialVariable];
if (!credentialPath) throw new Error(`Set ${credentialVariable} in .env.`);

const resolvedPath = path.resolve(process.cwd(), credentialPath);
if (!fs.existsSync(resolvedPath)) {
  throw new Error(
    `${profile} Firebase credentials were not found at ${resolvedPath}. Add the ignored JSON file or set GOOGLE_APPLICATION_CREDENTIALS.`,
  );
}

const credentials = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
if (credentials.project_id && credentials.project_id !== projectId) {
  throw new Error(
    `Credential project ${credentials.project_id} does not match FIREBASE_PROJECT_ID=${projectId}.`,
  );
}

console.log(
  `Firebase configuration is ready for project ${projectId} as ${profile}.`,
);

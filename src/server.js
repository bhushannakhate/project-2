import { pathToFileURL } from "node:url";
import process from "node:process";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";

export async function startServer() {
  const config = loadConfig();
  const app = createApp({ config });
  const server = app.listen(config.port, () => {
    console.log(`API listening on port ${config.port}`);
  });

  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startServer().catch((error) => {
    console.error("Unable to start the API server:", error);
    process.exitCode = 1;
  });
}

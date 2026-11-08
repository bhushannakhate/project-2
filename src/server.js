import { pathToFileURL } from "node:url";
import process from "node:process";
import { MongoClient } from "mongodb";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";

export async function startServer() {
  const config = loadConfig();
  let client;
  let customerCollection;

  if (config.demoCustomersEnabled) {
    client = new MongoClient(config.mongodbUri);
    try {
      await client.connect();
      customerCollection = client
        .db(config.mongodbDatabase)
        .collection("customers");
      await customerCollection.createIndex({ email: 1 }, { unique: true });
    } catch (error) {
      try {
        await client.close();
      } catch (closeError) {
        error.cause = closeError;
      }
      throw error;
    }
  }

  const app = createApp({ config, customerCollection });
  const server = app.listen(config.port, () => {
    console.log(`API listening on port ${config.port}`);
  });

  server.on("close", () => client?.close());
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

import process from "node:process";
import { MongoClient } from "mongodb";
import { config } from "./config/env.js";
import { createApp } from "./app.js";
import { createCustomerModel } from "./models/customerModel.js";

let client;

async function startServer() {
  let customerModel;
  if (config.demoCustomersEnabled) {
    client = new MongoClient(config.mongodbUri);
    await client.connect();
    customerModel = createCustomerModel(
      client.db(config.mongodbDatabase).collection("customers"),
    );
    await customerModel.ensureIndexes();
  }

  const server = createApp({ customerModel }).listen(config.port, () => {
    console.log(`API listening on port ${config.port}`);
  });

  const shutdown = async () => {
    server.close(async (error) => {
      if (error) {
        console.error("Error while closing the HTTP server:", error);
        process.exitCode = 1;
      }
      if (client) await client.close();
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch(async (error) => {
  console.error("Unable to start the API:", error);
  if (client) await client.close();
  process.exitCode = 1;
});

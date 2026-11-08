import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("MongoDB configuration is required only when demo routes are enabled", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "import('./src/config/env.js')"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DEMO_CUSTOMERS_ENABLED: "true",
        MONGODB_URI: "",
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /MONGODB_URI is required when DEMO_CUSTOMERS_ENABLED=true/,
  );
});

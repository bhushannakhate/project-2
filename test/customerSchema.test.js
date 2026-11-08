import assert from "node:assert/strict";
import test from "node:test";

import { validateCustomer } from "../src/customerSchema.js";

test("accepts and normalizes a valid customer", () => {
  const result = validateCustomer({
    fullName: " Test Customer ",
    email: "TEST@EXAMPLE.COM",
    username: "test.customer",
    interests: [" art ", ""],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.customer.fullName, "Test Customer");
  assert.equal(result.customer.email, "test@example.com");
  assert.deepEqual(result.customer.interests, ["art"]);
});

test("rejects missing required customer fields", () => {
  const result = validateCustomer({ fullName: "Test Customer" });

  assert.match(result.error, /email is required/);
});

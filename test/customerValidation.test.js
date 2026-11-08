import assert from "node:assert/strict";
import test from "node:test";

import { validateCustomer } from "../src/models/customerValidation.js";

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

test("rejects non-text interests", () => {
  const result = validateCustomer({
    fullName: "Test Customer",
    email: "test@example.com",
    username: "test",
    interests: [{}],
  });

  assert.match(result.error, /list of no more than 20 text items/);
});

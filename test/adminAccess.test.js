import assert from "node:assert/strict";
import test from "node:test";
import { createRequireAdminUser } from "../src/middleware/requireAdminUser.js";
import { ApiError } from "../src/middleware/errorHandler.js";
import { isAdminUser } from "../src/services/adminAccessService.js";

const adminEmails = ["admin@example.com"];

test("administrator access requires a verified allowlisted Firebase email", () => {
  assert.equal(
    isAdminUser(
      { email: " Admin@Example.com ", email_verified: true },
      adminEmails,
    ),
    true,
  );
  assert.equal(
    isAdminUser(
      { email: "admin@example.com", email_verified: false },
      adminEmails,
    ),
    false,
  );
  assert.equal(
    isAdminUser(
      { email: "other@example.com", email_verified: true },
      adminEmails,
    ),
    false,
  );
  assert.equal(
    isAdminUser(
      { email: "admin@example.com", email_verified: true, admin: true },
      [],
    ),
    false,
  );
});

test("admin middleware denies users not on the server allowlist", async () => {
  const middleware = createRequireAdminUser(adminEmails);
  let nextError;

  await middleware(
    { firebaseUser: { email: "other@example.com", email_verified: true } },
    {},
    (error) => {
      nextError = error;
    },
  );

  assert.ok(nextError instanceof ApiError);
  assert.equal(nextError.status, 403);
  assert.equal(nextError.code, "FORBIDDEN");
});

test("admin middleware permits a verified allowlisted email", async () => {
  const middleware = createRequireAdminUser(adminEmails);
  let nextCalled = false;

  await middleware(
    { firebaseUser: { email: "ADMIN@example.com", email_verified: true } },
    {},
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, true);
});

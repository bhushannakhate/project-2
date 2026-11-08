import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createRequireFirebaseUser } from "../src/middleware/requireFirebaseUser.js";
import { errorHandler, ApiError } from "../src/middleware/errorHandler.js";

async function withAuthServer({ verifyIdToken }, run) {
  const app = express();
  const requireUser = createRequireFirebaseUser(() => ({ verifyIdToken }));
  app.get("/protected", requireUser, (request, response) => {
    response.json({ user: request.user });
  });
  app.get("/forbidden", requireUser, (_request, _response, next) => {
    next(new ApiError(403, "FORBIDDEN", "Access is not permitted."));
  });
  app.use(errorHandler);

  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("valid tokens are checked for revocation and expose Firebase profile claims", async () => {
  const verifyIdToken = async () => ({
    uid: "firebase-user-123",
    email: "user@example.test",
    email_verified: true,
    name: "Example User",
    picture: "https://example.test/avatar.png",
  });
  let verificationArguments;

  await withAuthServer(
    {
      verifyIdToken: async (...args) => {
        verificationArguments = args;
        return verifyIdToken();
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { authorization: "Bearer valid-id-token" },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        user: {
          uid: "firebase-user-123",
          email: "user@example.test",
          emailVerified: true,
          name: "Example User",
          picture: "https://example.test/avatar.png",
        },
      });
      assert.deepEqual(verificationArguments, ["valid-id-token", true]);
    },
  );
});

test("missing and malformed bearer tokens return a consistent 401", async () => {
  let verificationCalls = 0;
  await withAuthServer(
    {
      verifyIdToken: async () => {
        verificationCalls += 1;
        return { uid: "unused" };
      },
    },
    async (baseUrl) => {
      for (const authorization of [
        undefined,
        "Basic malformed-token",
        "Bearer",
        "Bearer token with-spaces",
      ]) {
        const headers = authorization ? { authorization } : {};
        const response = await fetch(`${baseUrl}/protected`, { headers });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
          error: {
            code: "UNAUTHENTICATED",
            message: "A valid Firebase bearer token is required.",
          },
        });
      }
      assert.equal(verificationCalls, 0);
    },
  );
});

test("expired, invalid, and revoked tokens return the same 401 without echoing tokens", async () => {
  const failures = [
    ["expired-id-token", "auth/id-token-expired"],
    ["malformed-id-token", "auth/argument-error"],
    ["revoked-id-token", "auth/id-token-revoked"],
  ];

  await withAuthServer(
    {
      verifyIdToken: async (token) => {
        const failure = failures.find(
          ([invalidToken]) => invalidToken === token,
        );
        throw Object.assign(new Error(`verification failed for ${token}`), {
          code: failure?.[1],
        });
      },
    },
    async (baseUrl) => {
      for (const [token] of failures) {
        const response = await fetch(`${baseUrl}/protected`, {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(response.status, 401);
        const body = await response.text();
        assert.equal(body.includes(token), false);
        assert.deepEqual(JSON.parse(body), {
          error: {
            code: "UNAUTHENTICATED",
            message: "A valid Firebase bearer token is required.",
          },
        });
      }
    },
  );
});

test("authorization failures return a consistent 403 response", async () => {
  await withAuthServer(
    { verifyIdToken: async () => ({ uid: "firebase-user-123" }) },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/forbidden`, {
        headers: { authorization: "Bearer valid-id-token" },
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: {
          code: "FORBIDDEN",
          message: "Access is not permitted.",
        },
      });
    },
  );
});

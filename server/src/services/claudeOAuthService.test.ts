import assert from "node:assert/strict";
import test from "node:test";
import {
  executeWithClaudeOAuthRetry,
  isClaudeOAuthAuthenticationError,
  readOAuthToken,
  resolveOAuthTokenWithRefresh,
} from "./claudeOAuthService.js";

test("uses setup-token as CLI truth even when a caller requests a forced refresh", async () => {
  const previous = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "setup-token";
  try {
    assert.equal(
      await readOAuthToken({ forceCliRefresh: true }),
      "setup-token",
    );
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = previous;
  }
});

test("refreshes an expired stored token through the CLI before rereading it", async () => {
  const reads = [undefined, "fresh-token"];
  let refreshes = 0;
  const token = await resolveOAuthTokenWithRefresh(
    async () => reads.shift(),
    async () => {
      refreshes += 1;
    },
  );
  assert.equal(token, "fresh-token");
  assert.equal(refreshes, 1);
  assert.equal(reads.length, 0);
});

test("force refresh initializes the CLI before reading an otherwise-valid store", async () => {
  const order: string[] = [];
  const token = await resolveOAuthTokenWithRefresh(
    async () => {
      order.push("read");
      return "fresh-token";
    },
    async () => {
      order.push("refresh");
    },
    true,
  );
  assert.equal(token, "fresh-token");
  assert.deepEqual(order, ["refresh", "read"]);
});

test("retries exactly once with a CLI-refreshed token after HTTP 401", async () => {
  const seenTokens: string[] = [];
  const refreshFlags: boolean[] = [];
  const result = await executeWithClaudeOAuthRetry(
    async (token) => {
      seenTokens.push(token);
      if (token === "stale-token")
        throw new Error("HTTP 401: access token expired");
      return "ok";
    },
    async (forceRefresh) => {
      refreshFlags.push(forceRefresh);
      return forceRefresh ? "fresh-token" : "stale-token";
    },
    "stale-token",
  );
  assert.equal(result, "ok");
  assert.deepEqual(seenTokens, ["stale-token", "fresh-token"]);
  assert.deepEqual(refreshFlags, [true]);
});

test("does not retry when an unrefreshable setup-token is unchanged after 401", async () => {
  let attempts = 0;
  await assert.rejects(
    executeWithClaudeOAuthRetry(
      async () => {
        attempts += 1;
        throw new Error("HTTP 401: invalid access token");
      },
      async () => "setup-token",
      "setup-token",
    ),
    /HTTP 401/,
  );
  assert.equal(attempts, 1);
});

test("does not refresh or retry non-authentication failures", async () => {
  let tokenReads = 0;
  await assert.rejects(
    executeWithClaudeOAuthRetry(
      async () => {
        throw new Error("HTTP 500: upstream unavailable");
      },
      async () => {
        tokenReads += 1;
        return "unused";
      },
      "valid-token",
    ),
    /HTTP 500/,
  );
  assert.equal(tokenReads, 0);
  assert.equal(
    isClaudeOAuthAuthenticationError(new Error("HTTP 401: unauthorized")),
    true,
  );
  assert.equal(
    isClaudeOAuthAuthenticationError(new Error("HTTP 403: forbidden")),
    false,
  );
});

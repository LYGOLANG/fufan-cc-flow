import assert from "node:assert/strict";
import test from "node:test";
import { classifyClaudeAuthProbe, parseClaudeCliAuthStatus } from "./claudeAuthProbe.js";

test("maps Claude.ai terminal login to OAuth readiness", () => {
  assert.deepEqual(
    parseClaudeCliAuthStatus(JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
      email: "must-not-be-consumed@example.com",
    })),
    { authenticated: true, authMethod: "oauth" },
  );
});

test("maps CLI API-key login to API-key readiness", () => {
  assert.deepEqual(
    parseClaudeCliAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "apiKey" })),
    { authenticated: true, authMethod: "apikey" },
  );
});

test("keeps explicit logged-out state and rejects malformed output", () => {
  assert.deepEqual(
    parseClaudeCliAuthStatus(JSON.stringify({ loggedIn: false, authMethod: "none" })),
    { authenticated: false, authMethod: "none" },
  );
  assert.equal(parseClaudeCliAuthStatus("not json"), null);
  assert.equal(parseClaudeCliAuthStatus(JSON.stringify({ authMethod: "claude.ai" })), null);
});

test("only falls back for an unsupported auth command", () => {
  assert.deepEqual(classifyClaudeAuthProbe("", "unknown option '--json'", 1), { kind: "unsupported" });
  assert.deepEqual(classifyClaudeAuthProbe("not json", "temporary keychain failure", 1), { kind: "failed" });
  assert.deepEqual(
    classifyClaudeAuthProbe(JSON.stringify({ loggedIn: false, authMethod: "none" }), "", 1),
    { kind: "status", status: { authenticated: false, authMethod: "none" } },
  );
  assert.deepEqual(
    classifyClaudeAuthProbe(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), "", 1),
    { kind: "failed" },
  );
});

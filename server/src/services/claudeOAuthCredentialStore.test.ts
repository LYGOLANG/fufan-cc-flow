import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMacOsKeychainReadError,
  parseClaudeOAuthToken,
  shouldReadMacOsKeychain,
} from "./claudeOAuthCredentialStore.js";

test("parses only a non-expired, structurally valid Claude OAuth token", () => {
  assert.equal(
    parseClaudeOAuthToken(
      JSON.stringify({
        claudeAiOauth: { accessToken: "oauth-secret", expiresAt: 40_000 },
      }),
      1_000,
    ),
    "oauth-secret",
  );

  const rejected = [
    "not-json",
    JSON.stringify({
      claudeAiOauth: { accessToken: "expired", expiresAt: 1_000 },
    }),
    JSON.stringify({ claudeAiOauth: { accessToken: "missing-expiry" } }),
    JSON.stringify({
      claudeAiOauth: { accessToken: "near-expiry", expiresAt: 30_000 },
    }),
    JSON.stringify({
      claudeAiOauth: { accessToken: "string-expiry", expiresAt: "40000" },
    }),
    JSON.stringify({ claudeAiOauth: { accessToken: 123, expiresAt: 40_000 } }),
    JSON.stringify({ claudeAiOauth: { accessToken: "", expiresAt: 40_000 } }),
    JSON.stringify({
      claudeAiOauth: { accessToken: "nan-expiry", expiresAt: Number.NaN },
    }),
  ];
  for (const raw of rejected)
    assert.equal(parseClaudeOAuthToken(raw, 1_000), undefined);
});

test("only a definite Keychain item miss may fall back to legacy credentials", () => {
  assert.equal(classifyMacOsKeychainReadError({ code: 44 }), "missing");
  assert.equal(
    classifyMacOsKeychainReadError({
      stderr: "The specified item could not be found in the keychain.",
    }),
    "missing",
  );
  assert.equal(
    classifyMacOsKeychainReadError({ code: "ETIMEDOUT" }),
    "unavailable",
  );
  assert.equal(
    classifyMacOsKeychainReadError({
      code: 1,
      stderr: "User interaction is not allowed.",
    }),
    "unavailable",
  );
});

test("uses the default macOS Keychain only for the default Claude account", () => {
  assert.equal(shouldReadMacOsKeychain("darwin", undefined), true);
  assert.equal(shouldReadMacOsKeychain("darwin", ""), true);
  assert.equal(shouldReadMacOsKeychain("darwin", "/tmp/.claude-work"), false);
  assert.equal(shouldReadMacOsKeychain("linux", undefined), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeClaudeSettingsEnv,
  toPublicClaudeSettings,
} from "./claudeSettingsService.js";

test("redacts the persisted Anthropic API key from WebView settings", () => {
  assert.deepEqual(
    toPublicClaudeSettings({
      env: {
        ANTHROPIC_API_KEY: "secret-value",
        CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        ANTHROPIC_BASE_URL: "https://example.test",
        ANTHROPIC_MODEL: "example-model",
      },
    }),
    {
      env: {
        ANTHROPIC_BASE_URL: "https://example.test",
        ANTHROPIC_MODEL: "example-model",
      },
      secrets: { anthropicApiKeyConfigured: true },
    },
  );
});

test("reports no configured secret when the key is absent", () => {
  assert.deepEqual(toPublicClaudeSettings({ env: {} }), {
    env: {},
    secrets: { anthropicApiKeyConfigured: false },
  });
});

test("explicit empty strings remove saved secrets while preserving other env", () => {
  assert.deepEqual(
    mergeClaudeSettingsEnv(
      { ANTHROPIC_API_KEY: "secret", ANTHROPIC_MODEL: "opus" },
      { ANTHROPIC_API_KEY: "" },
    ),
    { ANTHROPIC_MODEL: "opus" },
  );
});

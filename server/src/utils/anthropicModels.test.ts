import assert from "node:assert/strict";
import test from "node:test";
import { assertOfficialAnthropicOAuthUrl } from "./anthropicModels.js";

test("allows Claude subscription OAuth only on the exact official Anthropic origin", () => {
  assert.doesNotThrow(() => assertOfficialAnthropicOAuthUrl(new URL("https://api.anthropic.com/v1/models")));
  assert.doesNotThrow(() => assertOfficialAnthropicOAuthUrl(new URL("https://api.anthropic.com:443/v1/models")));

  for (const target of [
    "http://api.anthropic.com/v1/models",
    "https://api.anthropic.com.evil.test/v1/models",
    "https://api.anthropic.com@evil.test/v1/models",
    "https://api.anthropic.com:444/v1/models",
  ]) {
    assert.throws(
      () => assertOfficialAnthropicOAuthUrl(new URL(target)),
      /restricted to api\.anthropic\.com/,
    );
  }
});

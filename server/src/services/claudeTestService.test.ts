import assert from "node:assert/strict";
import test from "node:test";
import { canAcceptResponseAfterTestError, testClaudeConnection } from "./claudeTestService.js";

test("accepts a real response followed by a maximum-budget cutoff", () => {
  assert.equal(
    canAcceptResponseAfterTestError("OK", "Claude Code returned an error result: Reached maximum budget"),
    true,
  );
});

test("rejects model-access errors even when the SDK surfaces them as assistant text", () => {
  const error =
    "Claude Code returned an error result: There's an issue with the selected model (gpt-5.6-sol). It may not exist or you may not have access to it.";

  assert.equal(canAcceptResponseAfterTestError(error, error), false);
});

test("rejects budget errors when no response was produced", () => {
  assert.equal(canAcceptResponseAfterTestError("", "Reached maximum budget"), false);
});

test("rejects a budget error message masquerading as the assistant response", () => {
  assert.equal(
    canAcceptResponseAfterTestError("Reached maximum budget", "Reached maximum budget"),
    false,
  );
});

function scriptedQuery(responseText: string, errorMessage?: string): typeof import("@anthropic-ai/claude-agent-sdk").query {
  return (() =>
    (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: responseText }] },
      };
      if (errorMessage) throw new Error(errorMessage);
    })()) as unknown as typeof import("@anthropic-ai/claude-agent-sdk").query;
}

test("production connection path rejects assistant-shaped model errors", async () => {
  const error =
    "Claude Code returned an error result: There's an issue with the selected model. It may not exist or you may not have access to it.";
  const result = await testClaudeConnection(
    { model: "unavailable-model" },
    { queryFn: scriptedQuery(error, error) },
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /selected model/);
});

test("production connection path accepts OK followed by the explicit test-budget cutoff", async () => {
  const result = await testClaudeConnection(
    { model: "test-model" },
    { queryFn: scriptedQuery("OK", "Claude Code returned an error result: Reached maximum budget") },
  );

  assert.equal(result.success, true);
  assert.equal(result.responseText, "OK");
});

test("production connection path rejects error text even when the stream ends normally", async () => {
  const response = "There's an issue with the selected model. It may not exist or you may not have access to it.";
  const result = await testClaudeConnection(
    { model: "unavailable-model" },
    { queryFn: scriptedQuery(response) },
  );

  assert.equal(result.success, false);
  assert.equal(result.responseText, "");
  assert.match(result.error ?? "", /非预期响应/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTransportError } from "../src/services/transport/error";
import { permissionEventIds } from "../src/services/transport/permission";
import {
  selectChatTransport,
  shouldUseRustChat,
} from "../src/services/transport/routing";
import {
  TauriChatConnection,
  type TauriChatRuntime,
} from "../src/services/transport/tauri-chat";
import type { ChatEventEnvelope } from "../src/services/transport/types";

async function flushPromises() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("Rust diagnostic flag selects one transport instead of a hybrid", () => {
  assert.equal(selectChatTransport(true, true), "tauri");
  assert.equal(selectChatTransport(true, false), "http");
  assert.equal(selectChatTransport(false, true), "http");
});

test("official Claude without SDK-only options uses Rust", () => {
  assert.equal(
    shouldUseRustChat({
      engine: "claude",
      providerId: "anthropic",
      effort: "high",
    }),
    true
  );
});

test("unsupported payloads are ineligible for the diagnostic Rust transport", () => {
  assert.equal(shouldUseRustChat({ engine: "codex" }), false);
  assert.equal(shouldUseRustChat({ providerId: "deepseek" }), false);
  assert.equal(shouldUseRustChat({ attachmentPaths: ["image.png"] }), false);
  assert.equal(shouldUseRustChat({ thinkingBudget: 16000 }), false);
  assert.equal(shouldUseRustChat({ apiKey: "temporary" }), false);
  assert.equal(shouldUseRustChat({ effort: "ultracode" }), false);
});

test("unsupported Rust requests emit their visible error after the send stack", async () => {
  const connection = new TauriChatConnection("/tmp/project");
  const events: Array<[string, Record<string, unknown>]> = [];
  connection.subscribe((event, payload) => events.push([event, payload]));

  assert.equal(connection.send("send_message", { engine: "codex" }), true);
  assert.equal(events.length, 0);
  await Promise.resolve();
  assert.deepEqual(events, [
    [
      "error",
      {
        code: "RUST_CHAT_UNSUPPORTED",
        message: "该请求仍依赖未迁移能力，请关闭 VITE_RUST_CHAT 开发开关后重试。",
      },
    ],
  ]);
});

test("Tauri adapter filters by canonical project key and closes that exact session", async () => {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  let listener:
    | ((event: { payload: ChatEventEnvelope }) => void)
    | undefined;
  let unlistenCount = 0;
  const runtime: TauriChatRuntime = {
    invoke: async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      return (command === "resolve_project_path" ? "/canonical/project" : undefined) as T;
    },
    listen: async <T>(
      _event: string,
      handler: (event: { payload: T }) => void
    ) => {
      listener = handler as (event: { payload: ChatEventEnvelope }) => void;
      return () => {
        unlistenCount += 1;
      };
    },
  };
  const connection = new TauriChatConnection("/alias/project", runtime);
  const events: string[] = [];
  connection.subscribe((event) => events.push(event));

  connection.connect();
  await flushPromises();
  assert.equal(connection.connected, true);
  listener?.({
    payload: {
      event: "assistant_text",
      payload: { projectPath: "/other/project", text: "wrong" },
      timestamp: 1,
    },
  });
  listener?.({
    payload: {
      event: "assistant_text",
      payload: { projectPath: "/canonical/project", text: "right" },
      timestamp: 2,
    },
  });
  assert.deepEqual(events, ["_connected", "assistant_text"]);

  connection.close();
  await flushPromises();
  assert.equal(unlistenCount, 1);
  const shutdown = calls.find(([command]) => command === "shutdown_project");
  assert.deepEqual(shutdown?.[1], {
    payload: {
      projectPath: "/alias/project",
      projectKey: "/canonical/project",
    },
  });
});

test("Tauri adapter retries after listener setup failure", async () => {
  let listenAttempts = 0;
  let abortCalls = 0;
  const runtime: TauriChatRuntime = {
    invoke: async <T>(command: string) => {
      if (command === "resolve_project_path") return "/canonical/project" as T;
      if (command === "abort") abortCalls += 1;
      return undefined as T;
    },
    listen: async () => {
      listenAttempts += 1;
      if (listenAttempts === 1) throw new Error("listener unavailable");
      return () => {};
    },
  };
  const connection = new TauriChatConnection("/alias/project", runtime);
  const errors: string[] = [];
  connection.subscribe((event, payload) => {
    if (event === "error") errors.push(payload.code as string);
  });

  connection.connect();
  await flushPromises();
  assert.equal(connection.connected, false);
  assert.deepEqual(errors, ["TAURI_CONNECT_FAILED"]);

  assert.equal(connection.send("abort"), true);
  await flushPromises();
  assert.equal(connection.connected, true);
  assert.equal(listenAttempts, 2);
  assert.equal(abortCalls, 1);
});

test("closing during project resolution does not install a late listener", async () => {
  let resolveProject: ((projectKey: string) => void) | undefined;
  let listenCount = 0;
  let shutdownCount = 0;
  const runtime: TauriChatRuntime = {
    invoke: <T>(command: string) => {
      if (command === "resolve_project_path") {
        return new Promise<string>((resolve) => {
          resolveProject = resolve;
        }) as Promise<T>;
      }
      if (command === "shutdown_project") shutdownCount += 1;
      return Promise.resolve(undefined as T);
    },
    listen: async () => {
      listenCount += 1;
      return () => {};
    },
  };
  const connection = new TauriChatConnection("/alias/project", runtime);

  connection.connect();
  connection.close();
  resolveProject?.("/canonical/project");
  await flushPromises();

  assert.equal(connection.connected, false);
  assert.equal(listenCount, 0);
  assert.equal(shutdownCount, 1);
});

test("preserves structured Tauri command errors", () => {
  assert.deepEqual(
    normalizeTransportError(
      { code: "INVALID_PROJECT", message: "项目目录不可访问", details: { path: "/x" } },
      "TAURI_INVOKE_FAILED"
    ),
    {
      code: "INVALID_PROJECT",
      message: "项目目录不可访问",
      details: { path: "/x" },
    }
  );
});

test("normalizes unstructured transport errors", () => {
  assert.deepEqual(
    normalizeTransportError(new Error("listener unavailable"), "TAURI_LISTEN_FAILED"),
    { code: "TAURI_LISTEN_FAILED", message: "listener unavailable" }
  );
});

test("permission control ID remains distinct from the tool card ID", () => {
  assert.deepEqual(
    permissionEventIds({ requestId: "control-1", toolCallId: "tool-9" }),
    { requestId: "control-1", toolCallId: "tool-9" }
  );
  assert.deepEqual(permissionEventIds({ requestId: "legacy-id" }), {
    requestId: "legacy-id",
    toolCallId: "legacy-id",
  });
});

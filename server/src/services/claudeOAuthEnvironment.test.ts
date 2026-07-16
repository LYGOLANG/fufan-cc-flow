import assert from "node:assert/strict";
import test from "node:test";
import {
  applyClaudeCliProxyEnv,
  createClaudeOAuthRefreshEnv,
  readClaudeSetupToken,
  selectClaudeSdkExecutable,
} from "./claudeOAuthEnvironment.js";

test("removes auth overrides from the Claude credential-refresh environment", () => {
  const env = createClaudeOAuthRefreshEnv({
    PATH: "/bin",
    HTTPS_PROXY: "http://127.0.0.1:7890",
    ANTHROPIC_API_KEY: "api-secret",
    ANTHROPIC_AUTH_TOKEN: "auth-secret",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret",
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3",
    CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: "4",
    ANTHROPIC_IDENTITY_TOKEN_FILE: "/tmp/identity-token",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDECODE: "1",
    CCR_OAUTH_TOKEN_FILE: "/tmp/remote-control-token",
    CLAUDE_SECURESTORAGE_CONFIG_DIR: "/tmp/alternate-keychain",
    DEBUG_CLAUDE_AGENT_SDK: "1",
    Anthropic_Api_Key: "mixed-case-secret",
  });
  assert.deepEqual(env, {
    PATH: "/bin",
    HTTPS_PROXY: "http://127.0.0.1:7890",
  });
});

test("reads only a non-empty official setup-token environment credential", () => {
  assert.equal(
    readClaudeSetupToken({ CLAUDE_CODE_OAUTH_TOKEN: " setup-token " }),
    "setup-token",
  );
  assert.equal(
    readClaudeSetupToken({ CLAUDE_CODE_OAUTH_TOKEN: "   " }),
    undefined,
  );
  assert.equal(
    readClaudeSetupToken({ Claude_Code_OAuth_Token: "mixed-case" }),
    undefined,
  );
});

test("uses the SDK bundled executable for Windows npm command shims", () => {
  assert.equal(
    selectClaudeSdkExecutable(
      "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd",
    ),
    undefined,
  );
  assert.equal(selectClaudeSdkExecutable("C:\\tools\\claude.bat"), undefined);
  assert.equal(
    selectClaudeSdkExecutable("C:\\Users\\me\\.local\\bin\\claude.exe"),
    "C:\\Users\\me\\.local\\bin\\claude.exe",
  );
  assert.equal(
    selectClaudeSdkExecutable("/Users/me/.local/bin/claude"),
    "/Users/me/.local/bin/claude",
  );
});

test("maps only supported HTTP/HTTPS proxies into Claude credential refresh", () => {
  const env = applyClaudeCliProxyEnv(
    {
      PATH: "/bin",
      HTTP_PROXY: "http://old-http:1",
      HTTPS_PROXY: "http://old-https:2",
      ALL_PROXY: "socks5://old-socks:3",
      NO_PROXY: "api.anthropic.com",
    },
    {
      httpProxy: "127.0.0.1:7890",
      httpsProxy: "https://secure-proxy.test:8443",
      socksProxy: "127.0.0.1:1080",
    },
  );
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7890");
  assert.equal(env.HTTPS_PROXY, "https://secure-proxy.test:8443");
  assert.equal(env.http_proxy, env.HTTP_PROXY);
  assert.equal(env.https_proxy, env.HTTPS_PROXY);
  assert.equal(env.ALL_PROXY, undefined);
  assert.equal(env.all_proxy, undefined);
  assert.equal(env.NO_PROXY, undefined);
});

test("an empty or unsupported SOCKS-only app proxy cannot inherit a process proxy", () => {
  const inherited = {
    HTTP_PROXY: "http://old-http:1",
    https_proxy: "http://old-https:2",
    ALL_PROXY: "socks5://old-socks:3",
    no_proxy: "api.anthropic.com",
  };
  assert.deepEqual(
    applyClaudeCliProxyEnv(inherited, {
      httpProxy: "",
      httpsProxy: "",
      socksProxy: "",
    }),
    {},
  );
  assert.deepEqual(
    applyClaudeCliProxyEnv(inherited, {
      httpProxy: "",
      httpsProxy: "",
      socksProxy: "127.0.0.1:1080",
    }),
    {},
  );
});

test("normal Claude sessions preserve setup-token auth while clearing inherited proxies", () => {
  assert.deepEqual(
    applyClaudeCliProxyEnv(
      {
        PATH: "/bin",
        CLAUDE_CODE_OAUTH_TOKEN: "setup-token",
        HTTP_PROXY: "http://ambient-http:1",
        https_proxy: "http://ambient-https:2",
        ALL_PROXY: "socks5://ambient-socks:3",
      },
      { httpProxy: "", httpsProxy: "", socksProxy: "" },
    ),
    { PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "setup-token" },
  );
});

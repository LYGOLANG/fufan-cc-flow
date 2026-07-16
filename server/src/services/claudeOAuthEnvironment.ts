import type { ProxyData } from "./proxyConfig.js";

const CLI_AUTH_OVERRIDE_ENV = [
  "CLAUDECODE",
  "CCR_OAUTH_TOKEN_FILE",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_IDENTITY_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
  "ANTHROPIC_AWS_API_KEY",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
  "CLAUDE_CODE_API_BASE_URL",
  "CLAUDE_CODE_API_KEY",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_CUSTOM_OAUTH_URL",
  "CLAUDE_CODE_FORCE_WINDOWS_CREDMAN",
  "CLAUDE_CODE_HFI_BEARER_TOKEN",
  "CLAUDE_CODE_HOST_AUTH",
  "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
  "CLAUDE_CODE_HOST_CREDS_FILE",
  "CLAUDE_CODE_OAUTH_CLIENT_ID",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  "CLAUDE_CODE_SDK_HAS_HOST_AUTH",
  "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
  "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
  "CLAUDE_CODE_SESSION_ACCESS_TOKEN",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR",
  "CLAUDE_CODE_DEBUG_LOGS_DIR",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "DEBUG_CLAUDE_AGENT_SDK",
] as const;

const CLI_AUTH_OVERRIDE_ENV_SET = new Set<string>(CLI_AUTH_OVERRIDE_ENV);
const PROXY_ENV_SET = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
]);

/** Official `claude setup-token` credential inherited by the CLI process. */
export function readClaudeSetupToken(
  source: NodeJS.ProcessEnv,
): string | undefined {
  const token = source.CLAUDE_CODE_OAUTH_TOKEN;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}

/** Isolate CLI credential refresh from unrelated host/API-key authentication. */
export function createClaudeOAuthRefreshEnv(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...source };
  // Windows environment keys are case-insensitive, so normalize every key.
  for (const name of Object.keys(env)) {
    if (CLI_AUTH_OVERRIDE_ENV_SET.has(name.toUpperCase())) delete env[name];
  }
  return env;
}

function withHttpScheme(value: string): string {
  return value.includes("://") ? value : `http://${value}`;
}

/**
 * Make the saved app proxy authoritative for every CLI process. Claude Code supports
 * HTTP(S) proxy variables but not SOCKS, so inherited ALL_PROXY is cleared and
 * the saved socksProxy is deliberately not forwarded.
 */
export function applyClaudeCliProxyEnv(
  source: NodeJS.ProcessEnv,
  proxy: ProxyData,
): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const name of Object.keys(env)) {
    if (PROXY_ENV_SET.has(name.toUpperCase())) delete env[name];
  }
  if (proxy.httpProxy) {
    env.HTTP_PROXY = withHttpScheme(proxy.httpProxy);
    env.http_proxy = env.HTTP_PROXY;
  }
  if (proxy.httpsProxy || proxy.httpProxy) {
    env.HTTPS_PROXY = withHttpScheme(proxy.httpsProxy || proxy.httpProxy);
    env.https_proxy = env.HTTPS_PROXY;
  }
  return env;
}

export function selectClaudeSdkExecutable(
  resolvedClaudeBin: string,
): string | undefined {
  // Node cannot spawn .cmd/.bat with shell:false. On that Windows/npm edge,
  // let the Agent SDK use its bundled native Claude executable.
  return /\.(?:cmd|bat)$/i.test(resolvedClaudeBin)
    ? undefined
    : resolvedClaudeBin;
}

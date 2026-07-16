import { tmpdir } from "os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolveClaudeBin } from "../utils/claudeBin.js";
import { logger } from "../utils/logger.js";
import { readStoredOAuthToken } from "./claudeOAuthCredentialStore.js";
import {
  applyClaudeCliProxyEnv,
  createClaudeOAuthRefreshEnv,
  readClaudeSetupToken,
  selectClaudeSdkExecutable,
} from "./claudeOAuthEnvironment.js";
import { readProxy } from "./proxyConfig.js";

const CLI_REFRESH_TIMEOUT_MS = 10_000;

export interface ReadClaudeOAuthTokenOptions {
  forceCliRefresh?: boolean;
}

export class ClaudeOAuthUnavailableError extends Error {
  constructor() {
    super("Claude CLI OAuth credentials are unavailable");
    this.name = "ClaudeOAuthUnavailableError";
  }
}

async function* emptyPrompt(): AsyncGenerator<never, void, unknown> {
  return;
}

async function initializeClaudeCredentialChain(): Promise<boolean> {
  const claudeBin = resolveClaudeBin();
  if (!claudeBin) return false;

  const abortController = new AbortController();
  let credentialQuery: ReturnType<typeof query> | undefined;
  const timer = setTimeout(
    () => abortController.abort(),
    CLI_REFRESH_TIMEOUT_MS,
  );
  timer.unref();

  try {
    const env = applyClaudeCliProxyEnv(
      createClaudeOAuthRefreshEnv(process.env),
      await readProxy(),
    );
    credentialQuery = query({
      // An empty streaming prompt initializes the official CLI credential
      // manager without sending a user message or starting a model turn.
      prompt: emptyPrompt(),
      options: {
        abortController,
        cwd: tmpdir(),
        env,
        extraArgs: { "safe-mode": null },
        mcpServers: {},
        pathToClaudeCodeExecutable: selectClaudeSdkExecutable(claudeBin),
        persistSession: false,
        settingSources: [],
        skills: [],
        strictMcpConfig: true,
        tools: [],
      },
    });
    await credentialQuery.initializationResult();
    return true;
  } catch {
    logger.warn("[oauth] Claude CLI credential initialization failed");
    return false;
  } finally {
    clearTimeout(timer);
    credentialQuery?.close();
  }
}

let credentialRefreshInFlight: Promise<boolean> | undefined;

async function refreshClaudeOAuthCredential(): Promise<boolean> {
  if (credentialRefreshInFlight) return credentialRefreshInFlight;

  const refresh = initializeClaudeCredentialChain();
  credentialRefreshInFlight = refresh;
  try {
    return await refresh;
  } finally {
    if (credentialRefreshInFlight === refresh)
      credentialRefreshInFlight = undefined;
  }
}

/** Pure orchestration seam used to prove expired-token recovery in tests. */
export async function resolveOAuthTokenWithRefresh(
  readToken: () => Promise<string | undefined>,
  refreshCredential: () => Promise<unknown>,
  forceRefresh = false,
): Promise<string | undefined> {
  if (!forceRefresh) {
    const stored = await readToken();
    if (stored) return stored;
  }
  await refreshCredential();
  return readToken();
}

/**
 * Read the Claude subscription token from the same stores as Claude CLI.
 * Missing/expired credentials are refreshed by initializing the official CLI
 * credential manager, which owns refresh-token rotation and cross-process
 * locking. The app never calls the OAuth refresh endpoint itself.
 */
export async function readOAuthToken(
  options: ReadClaudeOAuthTokenOptions = {},
): Promise<string | undefined> {
  // `claude setup-token` is an official CLI auth source with no Keychain/file
  // entry to refresh. Preserve that exact CLI truth even on a forced retry;
  // every network caller independently restricts this Bearer token to the
  // exact official Anthropic origin.
  const setupToken = readClaudeSetupToken(process.env);
  if (setupToken) return setupToken;

  return resolveOAuthTokenWithRefresh(
    readStoredOAuthToken,
    refreshClaudeOAuthCredential,
    options.forceCliRefresh === true,
  );
}

export function isClaudeOAuthAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\bHTTP\s+401\b/i.test(message) ||
    /\b(?:oauth|access)\s+token\b.{0,80}\b(?:expired|invalid|revoked)\b/i.test(
      message,
    )
  );
}

/** Pure retry seam: one auth failure may trigger one CLI refresh and one retry. */
export async function executeWithClaudeOAuthRetry<T>(
  operation: (token: string) => Promise<T>,
  readToken: (forceRefresh: boolean) => Promise<string | undefined>,
  initialToken?: string,
): Promise<T> {
  const token = initialToken || (await readToken(false));
  if (!token) throw new ClaudeOAuthUnavailableError();

  try {
    return await operation(token);
  } catch (error) {
    if (!isClaudeOAuthAuthenticationError(error)) throw error;
    const refreshedToken = await readToken(true);
    // setup-token credentials cannot be rotated through the local credential
    // store. If the forced read yields the same token, surface the original 401
    // instead of pretending a refresh happened and issuing a duplicate request.
    if (!refreshedToken || refreshedToken === token) throw error;
    return operation(refreshedToken);
  }
}

export async function withClaudeOAuthRetry<T>(
  operation: (token: string) => Promise<T>,
  initialToken?: string,
): Promise<T> {
  return executeWithClaudeOAuthRetry(
    operation,
    (forceRefresh) => readOAuthToken({ forceCliRefresh: forceRefresh }),
    initialToken,
  );
}

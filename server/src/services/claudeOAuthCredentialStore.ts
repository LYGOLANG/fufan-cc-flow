import { execFile } from "child_process";
import { promises as fs } from "fs";
import { userInfo } from "os";
import { join } from "path";
import { promisify } from "util";
import { getClaudeHome } from "../utils/pathUtils.js";

const MACOS_KEYCHAIN_SERVICE = "Claude Code-credentials";
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const execFileAsync = promisify(execFile);

type MacOsKeychainCredential =
  | { kind: "found"; raw: string }
  | { kind: "missing" }
  | { kind: "unavailable" };

export function parseClaudeOAuthToken(
  raw: string,
  now = Date.now(),
): string | undefined {
  try {
    const data = JSON.parse(raw) as {
      claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown };
    };
    const accessToken = data.claudeAiOauth?.accessToken;
    const expiresAt = data.claudeAiOauth?.expiresAt;
    if (typeof accessToken !== "string" || accessToken.trim().length === 0)
      return undefined;
    if (
      typeof expiresAt !== "number" ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now + TOKEN_EXPIRY_SKEW_MS
    )
      return undefined;
    return accessToken;
  } catch {
    return undefined;
  }
}

export function classifyMacOsKeychainReadError(
  error: unknown,
): "missing" | "unavailable" {
  if (!error || typeof error !== "object") return "unavailable";
  const details = error as {
    code?: unknown;
    stderr?: unknown;
    message?: unknown;
  };
  const text = `${typeof details.stderr === "string" ? details.stderr : ""}\n${
    typeof details.message === "string" ? details.message : ""
  }`;
  return details.code === 44 ||
    details.code === "44" ||
    /could not be found|item not found/i.test(text)
    ? "missing"
    : "unavailable";
}

export function shouldReadMacOsKeychain(
  platform: NodeJS.Platform,
  configDir?: string,
): boolean {
  // Custom CLAUDE_CONFIG_DIR accounts use their own directory credential store.
  return platform === "darwin" && !configDir?.trim();
}

async function readMacOsKeychainCredential(): Promise<MacOsKeychainCredential> {
  if (
    !shouldReadMacOsKeychain(process.platform, process.env.CLAUDE_CONFIG_DIR)
  ) {
    return { kind: "missing" };
  }
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        userInfo().username,
        "-s",
        MACOS_KEYCHAIN_SERVICE,
        "-w",
      ],
      { timeout: 3_000, maxBuffer: 256 * 1024, encoding: "utf-8" },
    );
    return { kind: "found", raw: stdout };
  } catch (error) {
    return { kind: classifyMacOsKeychainReadError(error) };
  }
}

export async function readStoredOAuthToken(): Promise<string | undefined> {
  const keychain = await readMacOsKeychainCredential();
  // An existing Keychain item is authoritative even when expired or malformed.
  if (keychain.kind === "found") return parseClaudeOAuthToken(keychain.raw);
  // ACL denial/timeout does not prove absence; fail closed instead of switching accounts.
  if (keychain.kind === "unavailable") return undefined;

  try {
    return parseClaudeOAuthToken(
      await fs.readFile(join(getClaudeHome(), ".credentials.json"), "utf-8"),
    );
  } catch {
    return undefined;
  }
}

import { join } from "path";
import { promises as fs, existsSync } from "fs";
import { logger } from "../utils/logger.js";
import { writePrivateFile } from "../utils/privateFile.js";
import { getClaudeHome } from "../utils/pathUtils.js";

const CLAUDE_DIR = getClaudeHome();
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");

export interface ClaudeSettings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface PublicClaudeSettings {
  env: Record<string, string>;
  secrets: { anthropicApiKeyConfigured: boolean };
}

/** Never return persisted secrets to the WebView. */
export function toPublicClaudeSettings(settings: ClaudeSettings): PublicClaudeSettings {
  const env = { ...(settings.env ?? {}) };
  const anthropicApiKeyConfigured = !!env.ANTHROPIC_API_KEY;
  for (const name of Object.keys(env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) delete env[name];
  }
  return { env, secrets: { anthropicApiKeyConfigured } };
}

/** Read ~/.claude/settings.json; returns {} if missing or corrupt */
export async function readClaudeSettings(): Promise<ClaudeSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf-8");
    return JSON.parse(raw) as ClaudeSettings;
  } catch {
    return {};
  }
}

/**
 * Merge env entries into ~/.claude/settings.json.
 * Pass `undefined` or `""` for a key to remove it.
 */
export async function writeClaudeSettingsEnv(
  env: Record<string, string | undefined>
): Promise<void> {
  const settings = await readClaudeSettings();
  const existing = mergeClaudeSettingsEnv(settings.env ?? {}, env);

  if (Object.keys(existing).length > 0) {
    settings.env = existing;
  } else {
    delete settings.env;
  }

  await writePrivateFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  logger.info(`[claudeSettings] env updated: ${Object.keys(existing).join(", ") || "(cleared)"}`);
}

/** Pure merge used by the writer and regression tests for explicit secret removal. */
export function mergeClaudeSettingsEnv(
  current: Record<string, string>,
  patch: Record<string, string | undefined>,
): Record<string, string> {
  const merged = { ...current };
  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined || value === "") delete merged[name];
    else merged[name] = value;
  }
  return merged;
}

/** Check if OAuth credentials file exists */
export function hasOAuthCredentials(): boolean {
  return existsSync(join(CLAUDE_DIR, ".credentials.json"));
}

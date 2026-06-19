/**
 * Load war-council/.env into process.env (does not override existing values).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..", "..");

/**
 * Parse a single .env line. Returns [key, value] or null.
 * @param {string} line
 */
export function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
export function applyEnvFile(filePath) {
  const applied = [];
  if (!existsSync(filePath)) return applied;
  const text = readFileSync(filePath, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}

/**
 * Load D:/war-council/.env (or WAR_COUNCIL_ROOT/.env).
 * @param {{ root?: string, silent?: boolean }} [options]
 */
export function loadWarCouncilEnv(options = {}) {
  const root = options.root || process.env.WAR_COUNCIL_ROOT || DEFAULT_ROOT;
  const path = resolve(root, ".env");
  const keys = applyEnvFile(path);
  if (!options.silent && process.env.WC_VERBOSE === "1" && keys.length) {
    process.stderr.write(
      `[war-council] applied ${keys.length} var(s) from .env (${path})\n`,
    );
  }
  return { path, keys, loaded: keys.length > 0 };
}

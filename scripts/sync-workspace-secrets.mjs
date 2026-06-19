/**
 * Canonical secrets hub: war-council/.env → workspace projects + Cloudflare Worker.
 *
 * Clerk is for AUTH only — never store API keys in Clerk metadata.
 * Remote access: run with --cloud after `npx wrangler login` on any machine.
 *
 * Usage (from war-council root):
 *   node scripts/sync-workspace-secrets.mjs              # local .env / .dev.vars
 *   node scripts/sync-workspace-secrets.mjs --cloud      # + wrangler secret put
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WC_ROOT = resolve(__dirname, "..");

const TARGETS = {
  ebookavplayer: process.env.EBOOKAVPLAYER_ROOT || "D:/EbookAVPlayer",
  portfolio: process.env.PORTFOLIO_ROOT || "D:/milkman-portfolio",
  cloudpilot: process.env.CLOUDPILOT_ROOT || "D:/CloudPilot",
};

/** Keys synced into each project's env files. */
const SYNC_KEYS = [
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "CEREBRAS_API_KEY",
  "MISTRAL_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "POLLINATIONS_TOKEN",
  "HF_TOKEN",
  "CLERK_JWKS_URL",
  "CLERK_ISSUER",
];

/** Encrypted Worker secrets (remote access via wrangler). */
const CLOUD_SECRETS = [
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "CEREBRAS_API_KEY",
  "MISTRAL_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "POLLINATIONS_TOKEN",
  "HF_TOKEN",
  "CLERK_JWKS_URL",
  "CLERK_ISSUER",
];

const CLERK_PUBLISHABLE =
  "pk_test_YnVyc3RpbmctdGFycG9uLTY1LmNsZXJrLmFjY291bnRzLmRldiQ";

function parseEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function upsertEnv(filePath, vars, header, keys = SYNC_KEYS) {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const keySet = new Set(keys);
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return true;
    const key = t.split("=")[0]?.trim();
    return !keySet.has(key);
  });
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  const block = [
    header,
    ...keys.filter((k) => vars[k]).map((k) => `${k}=${vars[k]}`),
    "",
  ];
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, [...kept, ...block].join("\n"), "utf-8");
}

function putWranglerSecret(cwd, name, value) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", name], {
    cwd,
    input: value,
    encoding: "utf-8",
    shell: true,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) {
    throw new Error(`wrangler secret put ${name} failed (exit ${r.status})`);
  }
}

const wcEnv = parseEnvFile(resolve(WC_ROOT, ".env"));
const pulled = Object.fromEntries(
  SYNC_KEYS.filter((k) => wcEnv[k]).map((k) => [k, wcEnv[k]]),
);

if (!Object.keys(pulled).length) {
  console.error(`No keys in ${resolve(WC_ROOT, ".env")} — fill war-council/.env first.`);
  process.exit(1);
}

console.log(`Hub: ${Object.keys(pulled).join(", ")}`);

// EbookAVPlayer backend .env
upsertEnv(
  resolve(TARGETS.ebookavplayer, ".env"),
  pulled,
  "# Synced from war-council/.env — never commit.",
);

// EbookAVPlayer frontend Clerk (publishable only)
upsertEnv(
  resolve(TARGETS.ebookavplayer, "web/.env.local"),
  { VITE_CLERK_PUBLISHABLE_KEY: CLERK_PUBLISHABLE, VITE_BASE_PATH: "/projects/ebookavplayer/" },
  "# Clerk publishable (safe in client) — synced from war-council hub.",
  ["VITE_CLERK_PUBLISHABLE_KEY", "VITE_BASE_PATH"],
);

// CloudPilot / portfolio Worker dev vars
for (const root of [TARGETS.portfolio, TARGETS.cloudpilot]) {
  upsertEnv(
    resolve(root, ".dev.vars"),
    pulled,
    "# Synced from war-council/.env — never commit.",
  );
}

console.log("Updated: EbookAVPlayer/.env, web/.env.local, portfolio + CloudPilot .dev.vars");

if (process.argv.includes("--cloud")) {
  const portfolio = TARGETS.portfolio;
  if (!pulled.CLOUDFLARE_API_TOKEN && !process.env.CLOUDFLARE_API_TOKEN) {
    console.warn("No CLOUDFLARE_API_TOKEN — wrangler may prompt for login.");
  }
  for (const name of CLOUD_SECRETS) {
    if (!pulled[name]) continue;
    console.log(`Uploading Worker secret ${name}...`);
    putWranglerSecret(portfolio, name, pulled[name]);
  }
  console.log("Cloudflare Worker secrets updated on milkman-webapp-portfolio.");
}

#!/usr/bin/env node
/**
 * Clone or pull hunter13118 repos updated within the last N minutes into repos/.
 *
 *   node scripts/sync-recent-repos.mjs [--minutes 30] [--owner hunter13118]
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WC_ROOT = resolve(__dirname, "..");
const REPOS_DIR = join(WC_ROOT, "repos");

const args = process.argv.slice(2);
const minutesIdx = args.indexOf("--minutes");
const ownerIdx = args.indexOf("--owner");
const minutes = minutesIdx >= 0 ? Number(args[minutesIdx + 1]) : 30;
const owner = ownerIdx >= 0 ? args[ownerIdx + 1] : "hunter13118";

if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error("✖ --minutes must be a positive number");
  process.exit(1);
}

const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
console.log(`⚔️  Syncing ${owner} repos updated since ${cutoff}`);

const raw = execSync(
  `gh api "users/${owner}/repos?per_page=100&sort=updated&direction=desc" --paginate`,
  { encoding: "utf-8" },
);
const repos = JSON.parse(`[${raw.trim().split(/\n(?=\[)/).join(",")}]`.replace(/\]\[/g, ","))
  .flat()
  .filter((r) => r.updated_at >= cutoff);

if (repos.length === 0) {
  console.log("No repos matched the window.");
  process.exit(0);
}

await mkdir(REPOS_DIR, { recursive: true });

for (const repo of repos) {
  if (repo.name === "war-council") {
    console.log(`◦ skip ${repo.name} (this checkout)`);
    continue;
  }
  const dest = join(REPOS_DIR, repo.name);
  if (existsSync(join(dest, ".git"))) {
    console.log(`↻ pull ${repo.name}`);
    execSync("git pull --ff-only", { cwd: dest, stdio: "inherit" });
  } else {
    console.log(`⬇ clone ${repo.name}`);
    execSync(`git clone --depth 1 "${repo.clone_url}" "${dest}"`, { stdio: "inherit" });
  }
}

const workspacePath = join(WC_ROOT, "war-council.code-workspace");
const { readFile } = await import("node:fs/promises");
let workspace;
try {
  workspace = JSON.parse(await readFile(workspacePath, "utf-8"));
} catch {
  workspace = { folders: [{ name: "war-council (MCP)", path: "." }], settings: {}, extensions: {} };
}

const existing = new Set((workspace.folders || []).map((f) => f.path));
for (const repo of repos) {
  const rel = `repos/${repo.name}`;
  if (repo.name === "war-council" || existing.has(rel)) continue;
  workspace.folders.push({ name: repo.name, path: rel });
  existing.add(rel);
}

await writeFile(workspacePath, JSON.stringify(workspace, null, 2) + "\n", "utf-8");
console.log(`✔ ${repos.length} repo(s) synced; workspace updated.`);

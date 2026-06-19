/**
 * apply_plan core — patch extraction, validation, git apply.
 */
import { resolve, dirname, relative } from "node:path";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { runCommand } from "./commands.js";
import { classifyShipTier } from "./ship-tier.js";
import { formatCallerHandoff } from "./ship-tier.js";
import { ollamaGenerateWithRetry } from "./ollama.js";
import { ARSENAL } from "./config.js";

const MAX_FILES = 12;
const MAX_BYTES = 120_000;

/**
 * @param {string} text
 * @returns {object[]|null}
 */
export function extractPatchesFromBrief(text) {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)\s*```/g)];
  for (const m of fences) {
    try {
      const j = JSON.parse(m[1]);
      const patches = j.patches || j;
      if (Array.isArray(patches) && patches.length) return patches;
    } catch {
      /* try next fence */
    }
  }
  const inline = text.match(/\{[\s\S]*"patches"[\s\S]*\}/);
  if (inline) {
    try {
      const j = JSON.parse(inline[0]);
      return j.patches || null;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * @param {string} brief
 * @param {string} task
 */
/**
 * @param {string} path
 * @param {string} content
 * @returns {string|null} error message or null if valid
 */
export function validatePatchContent(path, content) {
  const c = content ?? "";
  if (!c.trim()) return "empty file content";
  if (c.trim() === "..." || /^["']?\.\.\.["']?$/.test(c.trim())) return "placeholder content";
  if (path.endsWith(".json")) {
    try {
      JSON.parse(c);
    } catch (e) {
      return `invalid JSON: ${e.message}`;
    }
  }
  return null;
}

export async function generatePatchesFromHandoff(brief, task) {
  const existing = extractPatchesFromBrief(brief);
  if (existing?.length) return existing;

  const prompt = [
    "Extract or generate apply_plan patches from this handoff.",
    'Output JSON ONLY: { "patches": [ { "path": "rel/path", "op": "write", "content": "full file" } ] }',
    "Max 8 files. Relative paths only.",
    `TASK: ${task}`,
    "",
    brief.slice(0, 12000),
  ].join("\n");

  const r = await ollamaGenerateWithRetry(ARSENAL.specialist, prompt, { maxTokens: 8192 });
  const patches = extractPatchesFromBrief(r.text);
  if (!patches?.length) {
    throw new Error("Could not parse patches from handoff — add ```json patches``` block to brief");
  }
  return patches;
}

/**
 * @param {object[]} patches
 * @param {{ task: string, repoRoot: string, forceLocal?: boolean }} opts
 */
export function validatePatchSet(patches, { task, repoRoot, forceLocal = false }) {
  const tier = classifyShipTier(task, { force_local: forceLocal });
  const validated = [];
  let totalBytes = 0;

  for (const p of patches) {
    const rel = (p.path || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!rel || rel.includes("..")) {
      throw new Error(`Invalid patch path: ${p.path}`);
    }
    const abs = resolve(repoRoot, rel);
    if (!abs.startsWith(resolve(repoRoot))) {
      throw new Error(`Path escapes repo: ${rel}`);
    }
    const content = p.content ?? "";
    const contentErr = validatePatchContent(rel, content);
    if (contentErr) {
      throw new Error(`Patch ${rel}: ${contentErr}`);
    }
    totalBytes += Buffer.byteLength(content, "utf8");
    validated.push({ ...p, path: rel, abs });
  }

  if (validated.length > MAX_FILES) {
    const handoff = formatCallerHandoff({
      tier: "defer_to_caller",
      reason: `Patch set has ${validated.length} files (max ${MAX_FILES})`,
      task,
      planSummary: "Too many files for council apply",
      patchesForCaller: validated.map((v) => v.path),
    });
    return { allowed: false, tier, handoff, validated, totalBytes };
  }

  if (totalBytes > MAX_BYTES && !forceLocal) {
    const handoff = formatCallerHandoff({
      tier: "hybrid_ship",
      reason: `Patch set is ${totalBytes} bytes (max ${MAX_BYTES})`,
      task,
      planSummary: "Council applies subset; caller finishes overflow",
      patchesForCaller: validated.slice(0, 4).map((v) => v.path),
    });
    return { allowed: false, tier: { ...tier, tier: "hybrid_ship" }, handoff, validated, totalBytes };
  }

  if (tier.tier === "defer_to_caller" && !forceLocal) {
    return {
      allowed: false,
      tier,
      handoff: formatCallerHandoff({
        tier: tier.tier,
        reason: tier.reason,
        task,
        planSummary: "Scope deferred",
      }),
      validated,
      totalBytes,
    };
  }

  return { allowed: true, tier, validated, totalBytes };
}

/**
 * @param {object[]} validated
 * @param {{ dryRun?: boolean, repoRoot: string }} opts
 */
export async function applyValidatedPatches(validated, { dryRun = false, repoRoot }) {
  const applied = [];
  for (const p of validated) {
    if (p.op === "delete") {
      if (!dryRun && existsSync(p.abs)) await unlink(p.abs);
      applied.push({ path: p.path, op: "delete" });
      continue;
    }
    if (!dryRun) {
      await mkdir(dirname(p.abs), { recursive: true });
      await writeFile(p.abs, p.content ?? "", "utf-8");
    }
    applied.push({ path: p.path, op: p.op || "write" });
  }
  return { applied, repoRoot };
}

/**
 * @param {string} repoRoot
 * @param {string} slug
 * @param {string} [jobId]
 */
export async function createApplySnapshot(repoRoot, slug, jobId) {
  const status = await runCommand("git", ["status", "--porcelain"], repoRoot, 15_000);
  if (status.exitCode !== 0) {
    return { ok: false, skipped: true, message: "not a git repo" };
  }
  if (!status.stdout.trim()) {
    return { ok: true, stashed: false, message: "clean tree (nothing stashed)" };
  }
  const msg = jobId ? `council-pre-apply-${jobId}` : `council-pre-apply-${slug}`;
  const stash = await runCommand("git", ["stash", "push", "-m", msg], repoRoot, 30_000);
  if (stash.exitCode !== 0) {
    return { ok: false, stashed: false, message: stash.stderr || "stash failed" };
  }
  return { ok: true, stashed: true, message: msg };
}

/**
 * @param {string} repoRoot
 */
export async function gitDiffSummary(repoRoot) {
  const stat = await runCommand("git", ["diff", "--stat"], repoRoot, 30_000);
  return stat.stdout.trim() || "(no diff)";
}

/**
 * @param {string} repoRoot
 */
export function defaultHandoffPath(repoRoot) {
  return resolve(repoRoot, ".cline-context", "latest-council-handoff.md");
}

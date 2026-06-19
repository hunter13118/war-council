/**
 * Greenfield repo detection — sparse repos need scaffold/defer, not blind apply.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { walkDir } from "../../memory-engine/indexer.js";

/**
 * @param {string} repoRoot
 * @returns {Promise<{ sourceFileCount: number, hasPackageJson: boolean, isGreenfield: boolean }>}
 */
export async function surveyRepo(repoRoot) {
  let sourceFileCount = 0;
  try {
    const files = await walkDir(repoRoot);
    sourceFileCount = files.length;
  } catch {
    sourceFileCount = 0;
  }
  const hasPackageJson = existsSync(resolve(repoRoot, "package.json"));
  const isGreenfield =
    sourceFileCount < 6 || (hasPackageJson && sourceFileCount < 10 && !existsSync(resolve(repoRoot, "src")));
  return { sourceFileCount, hasPackageJson, isGreenfield };
}

/**
 * @param {string} brief
 * @returns {{ ok: boolean, reason?: string, files?: string[] }}
 */
export function parseBriefFiles(brief) {
  if (!brief?.includes("## FILES")) {
    return { ok: false, reason: "Brief missing ## FILES section" };
  }
  const section = brief.split("## FILES")[1]?.split("##")[0] || "";
  const files = [...section.matchAll(/^-\s*`?([^`\n—]+)`?\s*[—-]/gm)].map((m) => m[1].trim());
  const bullets = [...section.matchAll(/^-\s+(.+)$/gm)]
    .map((m) => m[1].split(/[—–-]/)[0].trim())
    .filter((f) => f.includes("/") || f.includes("\\") || f.endsWith(".js") || f.endsWith(".json"));
  return { ok: true, files: files.length ? files : bullets };
}

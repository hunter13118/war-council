/**
 * capture_visual_audit — Playwright screenshot + vision review.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runCommand } from "../shared/commands.js";
import { REPO_ROOT, WAR_COUNCIL_ROOT } from "../shared/config.js";
import { resolveActiveRepoRoot } from "../shared/resolve-repo-root.js";
import { handler as visualConsultHandler } from "./visual-consult.js";

const DEFAULT_QUESTION =
  "You are a senior UX reviewer. List layout issues, placeholder copy, and top 3 quick wins.";

export const schema = {
  name: "capture_visual_audit",
  description:
    "Capture a page screenshot with Playwright, then analyze with visual_consult. " +
    "Use for portfolio/UI audits during coding_delivery verify.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Page URL. Default http://localhost:5180/" },
      output_path: { type: "string", description: "PNG output path." },
      question: { type: "string" },
      repo_root: { type: "string" },
      wait_ms: { type: "number", description: "Default 2000." },
      capture_only: { type: "boolean", description: "Skip vision analysis." },
    },
  },
};

export async function handler(args) {
  const repoRoot = resolveActiveRepoRoot(args.repo_root);
  const url = args.url ?? "http://localhost:5180/";
  const outputPath =
    args.output_path ?? resolve(repoRoot, "public", "audit", "wc-capture.png");
  mkdirSync(dirname(outputPath), { recursive: true });

  const script = resolve(WAR_COUNCIL_ROOT, "scripts", "capture-screenshot.mjs");
  if (!existsSync(script)) {
    return {
      content: [{ type: "text", text: `capture script missing: ${script}` }],
      isError: true,
    };
  }

  const cap = await runCommand(
    "node",
    [script, "--url", url, "--out", outputPath, "--wait-ms", String(args.wait_ms ?? 2000)],
    WAR_COUNCIL_ROOT,
    120_000,
  );
  if (cap.exitCode !== 0) {
    return {
      content: [{ type: "text", text: `Capture failed:\n${cap.stderr || cap.stdout}` }],
      isError: true,
    };
  }

  if (args.capture_only) {
    return {
      content: [{ type: "text", text: `=== CAPTURE ✅ ===\n${outputPath}` }],
    };
  }

  const vision = await visualConsultHandler(
    {
      image_path: outputPath,
      question: args.question ?? DEFAULT_QUESTION,
    },
    {},
  );
  if (vision.isError) return vision;

  const text = [
    "=== CAPTURE_VISUAL_AUDIT ===",
    `url: ${url}`,
    `capture: ${outputPath}`,
    `repo: ${repoRoot || REPO_ROOT}`,
    "",
    vision.content?.[0]?.text ?? "",
  ].join("\n");

  return { content: [{ type: "text", text }] };
}

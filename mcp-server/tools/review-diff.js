/**
 * review_diff — Git diff piped through reasoning model for code review.
 */
import { ARSENAL, REPO_ROOT } from "../shared/config.js";
import { ollamaGenerate, formatConsultResult } from "../shared/ollama.js";
import { runCommand } from "../shared/commands.js";
import { resolveActiveRepoRoot } from "../shared/resolve-repo-root.js";

export const schema = {
  name: "review_diff",
  description:
    "Run `git diff` and pipe the result through the reasoning model for code review. " +
    "Use before committing. Returns the model's review of changes.",
  inputSchema: {
    type: "object",
    properties: {
      staged: { type: "boolean", description: "If true, review staged changes. Default false." },
      tier: {
        type: "string",
        enum: ["fast", "specialist", "reasoning", "heavy"],
        description: "Reviewer model tier. Default 'reasoning'. Use 'fast' for reconcile passes.",
      },
      repo_root: { type: "string", description: "Git repo for diff. Default active workspace." },
    },
  },
};

export async function handler(args, ctx) {
  const repoRoot = resolveActiveRepoRoot(args.repo_root);
  const diffArgs = args.staged ? ["diff", "--cached"] : ["diff"];
  const cmdRes = await runCommand("git", diffArgs, repoRoot, 60_000);
  if (cmdRes.exitCode !== 0) {
    return {
      content: [{ type: "text", text: `git diff failed (exit ${cmdRes.exitCode}):\n${cmdRes.stderr}` }],
      isError: true,
    };
  }
  const diff = cmdRes.stdout.trim();
  if (!diff) {
    return {
      content: [{ type: "text", text: `No ${args.staged ? "staged" : "unstaged"} changes to review.` }],
    };
  }
  const MAX_DIFF_CHARS = 60_000;
  const truncated = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + "\n\n[... diff truncated ...]"
    : diff;
  const tier = args.tier ?? "reasoning";
  const model = ARSENAL[tier];
  const reviewPrompt = [
    "You are a senior code reviewer. Review the following git diff for:",
    "1. Security issues (OWASP Top 10, path traversal, injection, secrets)",
    "2. Bugs (off-by-one, null deref, race conditions, error handling)",
    "3. Style violations (vs project conventions)",
    "4. Test coverage gaps (changes without corresponding tests)",
    "",
    "Be concise. Use a numbered list. Mark each finding [CRITICAL] [WARN] [NIT].",
    "If the diff looks fine, say 'LGTM' and explain in one sentence why.",
    "",
    "===== DIFF =====",
    truncated,
  ].join("\n");
  const r = await ollamaGenerate(model, reviewPrompt, { maxTokens: 4096 });
  return {
    content: [{ type: "text", text: formatConsultResult(`DIFF REVIEW [${tier}]`, r) }],
  };
}

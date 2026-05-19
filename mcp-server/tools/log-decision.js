/**
 * log_decision — Append structured decision to decisions.jsonl.
 */
import { join } from "node:path";
import { appendFile } from "node:fs/promises";
import { REPO_ROOT } from "../shared/config.js";

export const schema = {
  name: "log_decision",
  description:
    "Append a structured decision entry to decisions.jsonl at repo root. " +
    "These entries are eligible for indexing into Sovereign Memory.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "1-line decision title." },
      rationale: { type: "string", description: "Why this choice." },
      alternatives_rejected: { type: "string", description: "Other options considered." },
      related_files: { type: "array", items: { type: "string" }, description: "Files affected." },
    },
    required: ["title", "rationale"],
  },
};

export async function handler(args, ctx) {
  const entry = {
    timestamp: new Date().toISOString(),
    title: args.title,
    rationale: args.rationale,
    alternativesRejected: args.alternatives_rejected ?? null,
    relatedFiles: args.related_files ?? [],
  };
  const path = join(REPO_ROOT, "decisions.jsonl");
  await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");
  return {
    content: [{
      type: "text",
      text: [
        "=== DECISION LOGGED ===",
        `File: ${path}`,
        JSON.stringify(entry, null, 2),
        "",
        "Tip: run memory_index to make this decision retrievable via memory_query.",
      ].join("\n"),
    }],
  };
}

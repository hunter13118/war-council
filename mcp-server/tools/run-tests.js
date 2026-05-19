/**
 * run_tests — Execute test suites and return structured output.
 */
import { resolve } from "node:path";
import { REPO_ROOT } from "../shared/config.js";
import { runCommand } from "../shared/commands.js";

export const schema = {
  name: "run_tests",
  description:
    "Execute a test suite via npm and return structured output. " +
    "Suites: jest, python, e2e, all.",
  inputSchema: {
    type: "object",
    properties: {
      suite: {
        type: "string",
        enum: ["jest", "python", "e2e", "all"],
        description: "Which suite to run.",
      },
      timeout_ms: { type: "number", description: "Max ms before kill. Default 600000." },
    },
    required: ["suite"],
  },
};

export async function handler(args, ctx) {
  const timeout = args.timeout_ms ?? 600_000;
  const suite = args.suite;
  const npmScript =
    suite === "all" ? "test"
    : suite === "jest" ? "test:jest"
    : suite === "python" ? "test:python"
    : suite === "e2e" ? "test:e2e"
    : null;

  if (!npmScript) {
    return {
      content: [{ type: "text", text: `Unknown suite '${suite}'. Use jest|python|e2e|all.` }],
      isError: true,
    };
  }

  const cmdRes = await runCommand("npm", ["run", npmScript], REPO_ROOT, timeout);
  const combined = (cmdRes.stdout + "\n" + cmdRes.stderr).trim();
  const tail = combined.length > 4000 ? combined.slice(-4000) : combined;
  const passText =
    cmdRes.exitCode === 0 ? "✅ PASSED"
    : cmdRes.timedOut ? "⏱️ TIMED OUT"
    : `❌ FAILED (exit ${cmdRes.exitCode})`;

  const lines = [
    `=== run_tests: ${suite} (npm run ${npmScript}) ===`,
    `Status: ${passText}`,
    `Duration: ${cmdRes.elapsedMs}ms`,
    "",
    "----- output (last 4000 chars) -----",
    tail || "(no output captured)",
  ];

  // On E2E failure: find fresh screenshots
  if (cmdRes.exitCode !== 0 && (suite === "e2e" || suite === "all")) {
    try {
      const { readdirSync, statSync } = await import("node:fs");
      const resultsDir = resolve(REPO_ROOT, "milkman-portfolio", "test-results");
      const now = Date.now();
      const freshScreenshots = [];

      function findScreenshots(dir) {
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            if (entry.isDirectory()) findScreenshots(full);
            else if (entry.name.endsWith(".png")) {
              const stat = statSync(full);
              if (now - stat.mtimeMs < 300_000) freshScreenshots.push(full);
            }
          }
        } catch {}
      }
      findScreenshots(resultsDir);

      if (freshScreenshots.length > 0) {
        lines.push(
          "",
          "----- FAILURE SCREENSHOTS (use visual_consult to analyze) -----",
          ...freshScreenshots.slice(0, 5).map((p) => `  📸 ${p}`),
          "",
          "💡 TIP: Call visual_consult with any screenshot path above to get AI analysis of the failure."
        );
      }
    } catch {}
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

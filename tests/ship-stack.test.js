import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHAINS, executeChain } from "../mcp-server/task-chains.js";
import { routeTask } from "../mcp-server/decision-router.js";
import { classifyShipTier } from "../mcp-server/shared/ship-tier.js";
import {
  extractPatchesFromBrief,
  validatePatchContent,
} from "../mcp-server/shared/apply-plan-core.js";
import { parseBriefFiles } from "../mcp-server/shared/greenfield.js";
import {
  markDeliberationComplete,
  resetSession,
  getSessionState,
} from "../mcp-server/shared/protocol-gateway.js";
import { parseApplyMetaFromText } from "../mcp-server/shared/council-rollback.js";

describe("ship stack", () => {
  it("exports plan and verify chains", () => {
    assert.ok(CHAINS.apple_plan);
    assert.ok(CHAINS.coding_plan);
    assert.ok(CHAINS.coding_verify);
    assert.ok(CHAINS.apple_plan.steps.length >= 6);
  });

  it("routeTask detects coding tasks", () => {
    const r = routeTask("Add Playwright E2E tests to the app");
    assert.equal(r.tool, "coding_delivery");
    assert.equal(r.chain, "apple_plan");
  });

  it("classifyShipTier respects force_local", () => {
    const t = classifyShipTier("entire codebase rewrite", { force_local: true, estimated_files: 20 });
    assert.equal(t.tier, "council_ship");
  });

  it("classifyShipTier defers greenfield without force_local", () => {
    const t = classifyShipTier("Build React app", { estimated_files: 2 });
    assert.equal(t.tier, "defer_to_caller");
  });

  it("classifyShipTier hybrid on greenfield with force_local", () => {
    const t = classifyShipTier("Build React app", { force_local: true, estimated_files: 2 });
    assert.equal(t.tier, "hybrid_ship");
  });

  it("validatePatchContent rejects invalid JSON and placeholders", () => {
    assert.equal(validatePatchContent("package.json", "..."), "placeholder content");
    assert.match(validatePatchContent("package.json", "{bad"), /invalid JSON/);
    assert.equal(validatePatchContent("src/a.js", "ok"), null);
  });

  it("parseBriefFiles extracts file list", () => {
    const brief = "## FILES\n- `src/App.jsx` — main UI\n- package.json — deps\n## TESTS";
    const r = parseBriefFiles(brief);
    assert.equal(r.ok, true);
    assert.ok(r.files.length >= 1);
  });

  it("extractPatchesFromBrief parses JSON fence", () => {
    const text = 'brief\n```json\n{"patches":[{"path":"a.js","op":"write","content":"x"}]}\n```';
    const p = extractPatchesFromBrief(text);
    assert.equal(p.length, 1);
    assert.equal(p[0].path, "a.js");
  });

  it("parseApplyMetaFromText reads stash message", () => {
    const meta = parseApplyMetaFromText('snapshot: git stash push -m "council-pre-apply-abc"\n- write foo.js');
    assert.equal(meta.stashed, true);
    assert.equal(meta.appliedFiles[0], "foo.js");
  });

  it("markDeliberationComplete sets session flags", () => {
    resetSession();
    markDeliberationComplete();
    const s = getSessionState();
    assert.equal(s.deliberationComplete, true);
    assert.equal(s.memoryQueried, true);
  });

  it("executeChain runs parallel step", async () => {
    const calls = [];
    const result = await executeChain(
      "coding_plan",
      { task: "tiny task" },
      async (tool) => {
        calls.push(tool);
        if (tool === "memory_query") return "rag hit";
        if (tool === "consult_cloud" || tool === "consult_specialist") return `${tool} ok`;
        return `${tool} done`;
      },
    );
    assert.equal(result.success, true);
    assert.ok(calls.includes("memory_query"));
    const parallelStep = result.steps.find((s) => s.label?.includes("parallel"));
    assert.ok(parallelStep?.result?.includes("consult_cloud"));
  });
});

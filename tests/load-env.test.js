import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnvLine, applyEnvFile } from "../mcp-server/shared/load-env.js";

describe("load-env", () => {
  const saved = {};

  beforeEach(() => {
    for (const k of ["GEMINI_API_KEY", "GROQ_API_KEY", "FOO_TEST"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("parseEnvLine handles comments and quotes", () => {
    assert.deepEqual(parseEnvLine("# comment"), null);
    assert.deepEqual(parseEnvLine('GEMINI_API_KEY="abc123"'), ["GEMINI_API_KEY", "abc123"]);
  });

  it("applyEnvFile does not override existing env", () => {
    process.env.GEMINI_API_KEY = "already-set";
    const dir = mkdtempSync(join(tmpdir(), "wc-env-"));
    const path = join(dir, ".env");
    writeFileSync(path, "GEMINI_API_KEY=from-file\nGROQ_API_KEY=groq-val\n", "utf-8");
    const applied = applyEnvFile(path);
    assert.equal(process.env.GEMINI_API_KEY, "already-set");
    assert.equal(process.env.GROQ_API_KEY, "groq-val");
    assert.deepEqual(applied, ["GROQ_API_KEY"]);
    rmSync(dir, { recursive: true, force: true });
  });
});

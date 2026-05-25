/**
 * Integration test harness — spins up a mock Ollama server and exercises
 * MCP tools end-to-end (consult_fast, consult_specialist, etc.)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

// Mock Ollama server — returns canned responses
function createMockOllama() {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      calls.push({ url: req.url, method: req.method, body: parsed });

      if (req.url === "/api/generate") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          response: `Mock response for model=${parsed.model}`,
          eval_count: 50,
          eval_duration: 1000000000,
          prompt_eval_count: 10,
        }));
      } else if (req.url === "/api/version") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: "0.0.0-mock" }));
      } else if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          models: [
            { name: "qwen2.5-coder:7b", size: 4_000_000_000 },
            { name: "qwen2.5-coder:14b", size: 9_000_000_000 },
          ],
        }));
      } else if (req.url === "/api/embeddings") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ embedding: new Array(768).fill(0.1) }));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
  });
  return { server, calls };
}

describe("Integration: MCP tools with mock Ollama", () => {
  let mockOllama;
  let calls;
  let port;
  let originalEnv;

  before(async () => {
    ({ server: mockOllama, calls } = createMockOllama());
    await new Promise((resolve) => mockOllama.listen(0, resolve));
    port = mockOllama.address().port;
    // Override OLLAMA_BASE env so modules use our mock
    originalEnv = process.env.OLLAMA_BASE;
    process.env.OLLAMA_BASE = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    mockOllama.close();
    if (originalEnv !== undefined) process.env.OLLAMA_BASE = originalEnv;
    else delete process.env.OLLAMA_BASE;
  });

  it("consult_fast handler calls Ollama /api/generate", async () => {
    // Dynamic import so env is picked up
    const { ollamaGenerate } = await import("../mcp-server/shared/ollama.js");
    const result = await ollamaGenerate("qwen2.5-coder:7b", "Hello");
    assert.ok(result.text.includes("Mock response"));
    assert.equal(result.tokensPerSec, 50); // 50 tokens / 1s
    const lastCall = calls[calls.length - 1];
    assert.equal(lastCall.body.model, "qwen2.5-coder:7b");
    assert.equal(lastCall.body.prompt, "Hello");
  });

  it("ollamaGenerate passes options correctly", async () => {
    const { ollamaGenerate } = await import("../mcp-server/shared/ollama.js");
    await ollamaGenerate("qwen2.5-coder:14b", "Test prompt", {
      temperature: 0.8,
      maxTokens: 4096,
    });
    const lastCall = calls[calls.length - 1];
    assert.equal(lastCall.body.options.temperature, 0.8);
    assert.equal(lastCall.body.options.num_predict, 4096);
  });

  it("mock Ollama /api/tags responds with model list", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tags`);
    const data = await res.json();
    assert.ok(Array.isArray(data.models));
    assert.equal(data.models.length, 2);
  });

  it("mock Ollama /api/embeddings returns vector", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", prompt: "test" }),
    });
    const data = await res.json();
    assert.equal(data.embedding.length, 768);
  });

  it("ToolRegistry discovers and wraps all tools", async () => {
    const { ToolRegistry } = await import("../mcp-server/tool-registry.js");
    const registry = new ToolRegistry();
    const { resolve: resolvePath } = await import("node:path");
    await registry.discover(resolvePath(import.meta.dirname, "..", "mcp-server", "tools"));
    // Should have 30+ tools
    assert.ok(registry.size >= 30, `Expected 30+ tools, got ${registry.size}`);
    // Should be able to list schemas
    const schemas = registry.listSchemas();
    assert.ok(schemas.length >= 30);
    assert.ok(schemas.every(s => s.name && s.description && s.inputSchema));
  });

  it("ToolRegistry executes consult_fast via mock", async () => {
    const { ToolRegistry } = await import("../mcp-server/tool-registry.js");
    const registry = new ToolRegistry();
    const { resolve: resolvePath } = await import("node:path");
    await registry.discover(resolvePath(import.meta.dirname, "..", "mcp-server", "tools"));
    const result = await registry.execute("consult_fast", { prompt: "What is 2+2?" }, {});
    // Should get a response (not error)
    assert.ok(!result.isError, `Got error: ${result.content?.[0]?.text}`);
    assert.ok(result.content[0].text.includes("Mock response"));
  });

  it("ToolRegistry returns error for unknown tool", async () => {
    const { ToolRegistry } = await import("../mcp-server/tool-registry.js");
    const registry = new ToolRegistry();
    const result = await registry.execute("nonexistent_tool", {}, {});
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes("Unknown tool"));
  });

  it("list_arsenal tool returns model info", async () => {
    const { ToolRegistry } = await import("../mcp-server/tool-registry.js");
    const registry = new ToolRegistry();
    const { resolve: resolvePath } = await import("node:path");
    await registry.discover(resolvePath(import.meta.dirname, "..", "mcp-server", "tools"));
    const result = await registry.execute("list_arsenal", {}, {});
    assert.ok(!result.isError);
    // Should list models from arsenal.json
    assert.ok(result.content[0].text.includes("fast") || result.content[0].text.includes("specialist"));
  });

  it("run_dag tool validates DAG before execution", async () => {
    const { ToolRegistry } = await import("../mcp-server/tool-registry.js");
    const registry = new ToolRegistry();
    const { resolve: resolvePath } = await import("node:path");
    await registry.discover(resolvePath(import.meta.dirname, "..", "mcp-server", "tools"));
    // Invalid DAG — no entryNode
    const result = await registry.execute("run_dag", { dag: { id: "test", nodes: {} } }, {});
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes("Invalid DAG"));
  });

  it("switch_workspace tool lists workspaces", async () => {
    const { ToolRegistry } = await import("../mcp-server/tool-registry.js");
    const registry = new ToolRegistry();
    const { resolve: resolvePath } = await import("node:path");
    await registry.discover(resolvePath(import.meta.dirname, "..", "mcp-server", "tools"));
    const result = await registry.execute("switch_workspace", { action: "list" }, {});
    assert.ok(!result.isError);
    // Should return text (either workspaces listed or "No workspaces")
    assert.ok(result.content[0].text.length > 0);
  });
});

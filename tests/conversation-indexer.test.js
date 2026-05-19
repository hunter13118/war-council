import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

describe("Conversation Indexer", () => {
  let mockServer, port;

  before(async () => {
    mockServer = createServer((req, res) => {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ embedding: new Array(768).fill(0.01) }));
      });
    });
    await new Promise(r => mockServer.listen(0, r));
    port = mockServer.address().port;
    process.env.OLLAMA_BASE = `http://127.0.0.1:${port}`;
  });

  after(() => {
    mockServer.close();
    delete process.env.OLLAMA_BASE;
  });

  it("returns empty when log dir missing", async () => {
    const { indexConversations } = await import("../memory-engine/conversation-indexer.js");
    const result = await indexConversations({ logDir: join(tmpdir(), "nonexistent_xyz_" + Date.now()) });
    assert.equal(result.conversationsProcessed, 0);
    assert.equal(result.chunksCreated, 0);
  });

  it("indexes JSONL files with mock embeddings server", async () => {
    const { indexConversations } = await import("../memory-engine/conversation-indexer.js");
    const tmpDir = await mkdtemp(join(tmpdir(), "convlog-"));
    const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), message: "Hello world test message that is long enough" });
    await writeFile(join(tmpDir, "session.jsonl"), logEntry + "\n" + logEntry + "\n");

    const result = await indexConversations({
      logDir: tmpDir,
      storePath: join(tmpDir, "store.json"),
      chunkSize: 50,
    });

    assert.equal(result.conversationsProcessed, 1);
    assert.ok(result.chunksCreated >= 1);
    assert.equal(result.stub, false);
  });
});


import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { VectorStore } from "../memory-engine/store.js";
import { chunkText } from "../memory-engine/indexer.js";

describe("VectorStore", () => {
  let tmpDir, storePath;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vecstore-"));
    storePath = join(tmpDir, "store.json");
  });

  it("starts empty, add chunks, search returns them", async () => {
    const store = new VectorStore(storePath);
    await store.load();
    assert.equal(store.chunks.length, 0);

    // Add fake embeddings (3D for simplicity)
    await store.add([
      { text: "hello world", embedding: [1, 0, 0], source: "/a.js", tokenCount: 2 },
      { text: "goodbye world", embedding: [0, 1, 0], source: "/b.js", tokenCount: 2 },
      { text: "hello again", embedding: [0.9, 0.1, 0], source: "/a.js", tokenCount: 2 },
    ]);

    assert.equal(store.stats().totalChunks, 3);
    assert.equal(store.stats().uniqueFiles, 2);
    assert.equal(store.stats().stub, false);

    // Search with query similar to "hello world"
    const results = await store.search([1, 0, 0], 2);
    assert.equal(results.length, 2);
    assert.equal(results[0].chunk.text, "hello world");
    assert.ok(results[0].score > 0.9);
  });

  it("persists to disk and reloads", async () => {
    const store = new VectorStore(storePath);
    await store.load();
    await store.add([{ text: "persist me", embedding: [1, 1, 1], source: "/c.js" }]);
    await store.save();

    const store2 = new VectorStore(storePath);
    await store2.load();
    assert.equal(store2.chunks.length, 1);
    assert.equal(store2.chunks[0].text, "persist me");
  });

  it("filters by source", async () => {
    const store = new VectorStore(storePath);
    await store.add([
      { text: "a", embedding: [1, 0, 0], source: "/x.js" },
      { text: "b", embedding: [1, 0, 0], source: "/y.js" },
    ]);
    const results = await store.search([1, 0, 0], 5, { source: "/x.js" });
    assert.equal(results.length, 1);
    assert.equal(results[0].chunk.source, "/x.js");
  });

  it("respects minScore filter", async () => {
    const store = new VectorStore(storePath);
    await store.add([
      { text: "match", embedding: [1, 0, 0], source: "/a.js" },
      { text: "nomatch", embedding: [0, 0, 1], source: "/b.js" },
    ]);
    const results = await store.search([1, 0, 0], 5, { minScore: 0.5 });
    assert.equal(results.length, 1);
  });
});

describe("chunkText", () => {
  it("splits long text into chunks", () => {
    const text = "line\n".repeat(200);
    const chunks = chunkText(text, 100, 20);
    assert.ok(chunks.length > 1);
    // Each chunk should be roughly within budget
    for (const c of chunks) {
      assert.ok(c.length <= 200); // some slack due to line boundaries
    }
  });

  it("returns single chunk for short text", () => {
    const chunks = chunkText("short text", 500, 50);
    assert.equal(chunks.length, 1);
  });
});

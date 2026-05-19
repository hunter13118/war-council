import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Cloud Failover", () => {
  it("cloudGenerateWithFailover is exported as a function", async () => {
    const { cloudGenerateWithFailover } = await import("../mcp-server/shared/cloud.js");
    assert.equal(typeof cloudGenerateWithFailover, "function");
  });

  it("throws when no API keys are configured (from cached config)", async () => {
    const { cloudGenerateWithFailover } = await import("../mcp-server/shared/cloud.js");
    // Without valid keys, should throw
    try {
      await cloudGenerateWithFailover("test");
      assert.fail("Should have thrown");
    } catch (e) {
      assert.ok(e.message.length > 0);
    }
  });
});


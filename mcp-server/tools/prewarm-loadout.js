/**
 * prewarm_loadout — Pre-load models into VRAM.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaLoad } from "../shared/ollama.js";

export const schema = {
  name: "prewarm_loadout",
  description:
    "Pre-load specified models into VRAM with 30min keep-alive. " +
    "Use at session start to avoid cold-load latency on first call.",
  inputSchema: {
    type: "object",
    properties: {
      models: {
        type: "array",
        items: { type: "string" },
        description: "Arsenal keys ('fast','specialist','reasoning','heavy') or raw model names.",
      },
      keepAlive: {
        type: "string",
        description: "Ollama keep-alive duration. Default '30m'.",
      },
    },
    required: ["models"],
  },
};

export async function handler(args, ctx) {
  const t0 = Date.now();
  const results = [];
  for (const m of args.models) {
    const target = ARSENAL[m] ?? m;
    try {
      const r = await ollamaLoad(target, args.keepAlive ?? "30m");
      results.push(`  ✅ ${target} loaded in ${r.elapsedMs}ms`);
    } catch (e) {
      results.push(`  ❌ ${target} failed: ${e.message}`);
    }
  }
  return {
    content: [{
      type: "text",
      text: [
        `=== PREWARM_LOADOUT (${args.models.length} models, ${Date.now() - t0}ms wall) ===`,
        "",
        ...results,
        "",
        `Keep-alive: ${args.keepAlive ?? "30m"}. Models will stay hot until idle timeout.`,
      ].join("\n"),
    }],
  };
}

/**
 * list_arsenal — List local Ollama models and delegation map.
 */
import { ARSENAL } from "../shared/config.js";
import { listLocalModels } from "../shared/ollama.js";

export const schema = {
  name: "list_arsenal",
  description: "List local Ollama models with sizes. Useful to know what tools you actually have available.",
  inputSchema: { type: "object", properties: {} },
};

export async function handler(args, ctx) {
  const models = await listLocalModels();
  const lines = [
    `Local Ollama arsenal (${models.length} models):`,
    "",
    ...models.map((m) => `  ${m.name.padEnd(28)} ${m.sizeMB} MB`),
    "",
    "Conductor delegation map:",
    ...Object.entries(ARSENAL).map(([role, model]) => `  ${role.padEnd(12)} → ${model}`),
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

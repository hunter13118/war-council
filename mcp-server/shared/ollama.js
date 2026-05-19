/**
 * Ollama API integration — generate, load, list, vision.
 */
import { readFile } from "node:fs/promises";
import { OLLAMA_BASE, OLLAMA_CONTEXT_LENGTH, OLLAMA_KEEP_ALIVE, ARSENAL } from "./config.js";
import { withRetry } from "./retry.js";

export async function ollamaGenerate(model, prompt, options = {}) {
  const t0 = Date.now();
  const body = {
    model,
    prompt,
    stream: false,
    keep_alive: options.keepAlive ?? OLLAMA_KEEP_ALIVE,
    options: {
      temperature: options.temperature ?? 0.2,
      num_predict: options.maxTokens ?? 2048,
      num_ctx: options.contextLength ?? OLLAMA_CONTEXT_LENGTH,
    },
  };

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const elapsedMs = Date.now() - t0;
  const tps =
    data.eval_count && data.eval_duration
      ? Math.round((data.eval_count / data.eval_duration) * 1e9)
      : null;

  return {
    text: data.response || "",
    thinking: data.thinking || "",
    fullText: ((data.thinking || "") + "\n" + (data.response || "")).trim(),
    model,
    elapsedMs,
    tokensIn: data.prompt_eval_count ?? null,
    tokensOut: data.eval_count ?? null,
    tokensPerSec: tps,
  };
}

export async function ollamaGenerateWithRetry(model, prompt, options = {}) {
  return withRetry(() => ollamaGenerate(model, prompt, options), {
    maxRetries: 3,
    baseDelayMs: 2000,
    label: `ollama/${model}`,
  });
}

export async function ollamaLoad(model, keepAlive = "30m") {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, keep_alive: keepAlive }),
  });
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  await res.json();
  return { model, elapsedMs: Date.now() - t0 };
}

export async function listLocalModels() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) throw new Error(`Ollama tags HTTP ${res.status}`);
  const data = await res.json();
  return (data.models ?? []).map((m) => ({
    name: m.name,
    sizeMB: Math.round(m.size / (1024 * 1024)),
    modified: m.modified_at,
  }));
}

export async function ollamaVisualize(model, imagePath, question, options = {}) {
  const t0 = Date.now();
  const bytes = await readFile(imagePath);
  const b64 = bytes.toString("base64");
  const body = {
    model,
    stream: false,
    keep_alive: options.keepAlive ?? "30m",
    messages: [
      {
        role: "user",
        content: question,
        images: [b64],
      },
    ],
    options: {
      temperature: options.temperature ?? 0.2,
      num_predict: options.maxTokens ?? 1024,
    },
  };
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Ollama vision HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const elapsedMs = Date.now() - t0;
  const tps =
    data.eval_count && data.eval_duration
      ? Math.round((data.eval_count / data.eval_duration) * 1e9)
      : null;
  return {
    text: data.message?.content ?? "",
    model,
    elapsedMs,
    imageBytes: bytes.length,
    tokensIn: data.prompt_eval_count ?? null,
    tokensOut: data.eval_count ?? null,
    tokensPerSec: tps,
  };
}

export function formatConsultResult(label, result) {
  return [
    `=== ${label} ${result.model} ===`,
    `(${result.tokensOut ?? "?"} tokens in ${result.elapsedMs}ms${
      result.tokensPerSec ? `, ${result.tokensPerSec} tok/s` : ""
    })`,
    "",
    result.text.trim(),
  ].join("\n");
}

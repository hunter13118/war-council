/**
 * Cloud API integrations — Gemini (1M ctx) and Groq (fast inference).
 */
import { GEMINI_API_KEY, GEMINI_MODEL, GROQ_API_KEY, GROQ_MODEL } from "./config.js";
import { withRetry } from "./retry.js";
import { checkRateLimit } from "./rate-limiter.js";

export async function geminiGenerate(prompt, options = {}) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set. Get one free at https://aistudio.google.com/apikey");
  checkRateLimit("gemini");
  const t0 = Date.now();
  const model = options.model ?? GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.3,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const usage = data.usageMetadata ?? {};

  return {
    text,
    model,
    provider: "gemini",
    elapsedMs: Date.now() - t0,
    tokensIn: usage.promptTokenCount ?? null,
    tokensOut: usage.candidatesTokenCount ?? null,
  };
}

export async function groqGenerate(prompt, options = {}) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY not set. Get one free at https://console.groq.com/keys");
  checkRateLimit("groq");
  const t0 = Date.now();
  const model = options.model ?? GROQ_MODEL;

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: options.maxTokens ?? 8192,
    temperature: options.temperature ?? 0.3,
  };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage ?? {};

  return {
    text,
    model,
    provider: "groq",
    elapsedMs: Date.now() - t0,
    tokensIn: usage.prompt_tokens ?? null,
    tokensOut: usage.completion_tokens ?? null,
  };
}

export async function strategicPlan(task, codeContext, options = {}) {
  const systemPrompt = `You are a senior software architect acting as a strategic planner.
You receive a task description and relevant code context from a codebase.
Your job is to produce a STRUCTURED EXECUTION PLAN that a coding AI can follow step-by-step.

Rules:
- Break complex tasks into 3-7 atomic steps
- Each step must be specific and verifiable (not vague)
- Include file paths and line numbers when relevant
- Flag risks, edge cases, and dependencies between steps
- If you see bugs or issues in the provided code, note them
- Output format: numbered steps with brief rationale

Do NOT write code. Write the PLAN to write code.`;

  const fullPrompt = `${systemPrompt}\n\n## TASK\n${task}\n\n## CODE CONTEXT\n${codeContext}`;
  return withRetry(
    () => geminiGenerate(fullPrompt, { maxTokens: options.maxTokens ?? 4096, temperature: 0.2 }),
    { maxRetries: 2, baseDelayMs: 3000, label: "strategic_plan/gemini" }
  );
}

export async function rapidFanOut(prompts, options = {}) {
  const t0 = Date.now();
  const results = await Promise.all(
    prompts.map((prompt) =>
      withRetry(() => groqGenerate(prompt, { maxTokens: options.maxTokens ?? 2048 }), {
        maxRetries: 2,
        baseDelayMs: 1500,
        label: "rapid_fan_out/groq",
      })
    )
  );
  return {
    results,
    totalElapsedMs: Date.now() - t0,
    count: results.length,
  };
}

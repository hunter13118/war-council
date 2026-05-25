/**
 * Cloud API integrations — Gemini, Groq, and OpenRouter (free tier models).
 */
import { GEMINI_API_KEY, GEMINI_MODEL, GROQ_API_KEY, GROQ_MODEL, OPENROUTER_API_KEY, OPENROUTER_MODEL } from "./config.js";
import { withRetry } from "./retry.js";
import { checkRateLimit, getRateLimitStats } from "./rate-limiter.js";

/**
 * Cloud generate with automatic failover.
 * Tries primary provider first; on rate limit or error, falls back through chain.
 * @param {string} prompt
 * @param {object} options - { primary: "gemini"|"groq"|"openrouter", maxTokens, temperature }
 * @returns {Promise<object>} - standard result with { text, model, provider, failedOver }
 */
export async function cloudGenerateWithFailover(prompt, options = {}) {
  const primary = options.primary ?? "gemini";
  const generators = { gemini: geminiGenerate, groq: groqGenerate, openrouter: openRouterGenerate };
  const keys = { gemini: GEMINI_API_KEY, groq: GROQ_API_KEY, openrouter: OPENROUTER_API_KEY };
  const fallbackOrder = ["gemini", "groq", "openrouter"].filter(p => p !== primary && keys[p]);

  try {
    const result = await generators[primary](prompt, options);
    return { ...result, failedOver: false };
  } catch (primaryErr) {
    for (const fallback of fallbackOrder) {
      try {
        const result = await generators[fallback](prompt, options);
        return { ...result, failedOver: true, primaryError: primaryErr.message };
      } catch { continue; }
    }
    throw new Error(`All cloud providers failed. Primary (${primary}): ${primaryErr.message}`);
  }
}

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

export async function openRouterGenerate(prompt, options = {}) {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set. Get one free at https://openrouter.ai/keys");
  checkRateLimit("openrouter");
  const t0 = Date.now();
  const model = options.model ?? OPENROUTER_MODEL;

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: options.maxTokens ?? 8192,
    temperature: options.temperature ?? 0.3,
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://github.com/hunter13118/war-council",
      "X-Title": "War Council",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage ?? {};

  return {
    text,
    model: data.model || model,
    provider: "openrouter",
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

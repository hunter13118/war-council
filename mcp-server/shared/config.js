/**
 * Centralized configuration — loads arsenal.json + env overrides.
 * Single source of truth for all paths, model names, and API keys.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const arsenalPath = resolve(__dirname, "..", "..", "arsenal.json");
const arsenalConfig = JSON.parse(readFileSync(arsenalPath, "utf-8"));

export const OLLAMA_BASE = process.env.OLLAMA_BASE || arsenalConfig.defaults.ollama_base;
export const OLLAMA_CONTEXT_LENGTH = parseInt(process.env.OLLAMA_CONTEXT_LENGTH || "32768", 10);
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";

export const REPO_ROOT =
  process.env.REPO_ROOT || resolve(__dirname, "..", "..", "..");
export const BATTLE_LOG_PATH = resolve(REPO_ROOT, ".cline-context", "battle-log.jsonl");

export const MEMORY_STORE_PATH =
  process.env.MEMORY_STORE_PATH ||
  resolve(__dirname, "..", "..", "memory-engine", "store.json");

export const MEMORY_EMBED_MODEL =
  process.env.MEMORY_EMBED_MODEL || arsenalConfig.models.embed.name;

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || arsenalConfig.cloud.gemini.name;
export const GROQ_MODEL = process.env.GROQ_MODEL || arsenalConfig.cloud.groq.name;

export const ARSENAL = {
  fast: process.env.MODEL_FAST || arsenalConfig.models.fast.name,
  specialist: process.env.MODEL_SPECIALIST || arsenalConfig.models.specialist.name,
  reasoning: process.env.MODEL_REASONING || arsenalConfig.models.reasoning.name,
  heavy: process.env.MODEL_HEAVY || arsenalConfig.models.heavy.name,
};

export { arsenalConfig };

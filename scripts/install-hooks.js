#!/usr/bin/env node
/**
 * Install Git Hooks — Symlinks the pre-commit hook into .git/hooks/
 * Run: node scripts/install-hooks.js
 * 
 * Works on Windows (copies) and Unix (symlinks).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const hooksDir = resolve(repoRoot, '.git', 'hooks');
const source = resolve(__dirname, 'pre-commit');
const target = resolve(hooksDir, 'pre-commit');

if (!existsSync(resolve(repoRoot, '.git'))) {
  console.error('❌ Not a git repository. Run from the repo root.');
  process.exit(1);
}

mkdirSync(hooksDir, { recursive: true });
copyFileSync(source, target);

// Make executable on Unix
try { chmodSync(target, 0o755); } catch {}

console.log(`✅ Pre-commit hook installed: ${target}`);
console.log('   Runs syntax + architecture + security checks before each commit.');
console.log('   Set WAR_COUNCIL_FULL_VERIFY=1 to include tests.');

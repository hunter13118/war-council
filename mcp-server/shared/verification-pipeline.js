/**
 * Verification Pipeline
 *
 * Runs a sequence of checks (syntax, tests, architecture rules) against
 * a workspace before allowing a commit. Returns pass/fail with details.
 *
 * Designed for multi-workspace use — each check receives the workspace path.
 */
import { execSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

/**
 * @typedef {Object} CheckResult
 * @property {string} name
 * @property {'pass'|'fail'|'warn'|'skip'} status
 * @property {string} [message]
 * @property {number} durationMs
 */

/**
 * @typedef {Object} PipelineResult
 * @property {'pass'|'fail'} overall
 * @property {CheckResult[]} checks
 * @property {number} totalMs
 */

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/**
 * Run the full verification pipeline against a workspace.
 * @param {string} workspacePath
 * @param {Object} [options]
 * @param {string[]} [options.skip] - Check names to skip
 * @param {string} [options.testCommand] - Custom test command
 * @returns {Promise<PipelineResult>}
 */
export async function runPipeline(workspacePath, options = {}) {
  const skip = new Set(options.skip || []);
  const checks = [
    { name: 'syntax', fn: checkSyntax },
    { name: 'tests', fn: checkTests },
    { name: 'architecture', fn: checkArchitecture },
    { name: 'security', fn: checkSecurity },
  ];

  const results = [];
  const start = Date.now();

  for (const check of checks) {
    if (skip.has(check.name)) {
      results.push({ name: check.name, status: 'skip', durationMs: 0 });
      continue;
    }
    const t0 = Date.now();
    try {
      const result = await check.fn(workspacePath, options);
      results.push({ ...result, name: check.name, durationMs: Date.now() - t0 });
    } catch (e) {
      results.push({ name: check.name, status: 'fail', message: e.message, durationMs: Date.now() - t0 });
    }
  }

  const overall = results.some(r => r.status === 'fail') ? 'fail' : 'pass';
  return { overall, checks: results, totalMs: Date.now() - start };
}

/**
 * Syntax check — runs `node --check` on all JS files.
 */
async function checkSyntax(workspacePath) {
  const files = await findJSFiles(workspacePath);
  const errors = [];

  for (const file of files) {
    try {
      execSync(`node --check "${file}"`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch (e) {
      errors.push(`${file}: ${e.stderr?.split('\n')[0] || e.message}`);
    }
  }

  if (errors.length > 0) {
    return { status: 'fail', message: `${errors.length} file(s) with syntax errors:\n${errors.slice(0, 5).join('\n')}` };
  }
  return { status: 'pass', message: `${files.length} files checked` };
}

/**
 * Tests check — runs the test command for the workspace.
 */
async function checkTests(workspacePath, options) {
  const cmd = options.testCommand || detectTestCommand(workspacePath);
  if (!cmd) return { status: 'skip', message: 'No test command detected' };

  try {
    execSync(cmd, { cwd: workspacePath, encoding: 'utf-8', stdio: 'pipe', timeout: 120000 });
    return { status: 'pass', message: `Tests passed (${cmd})` };
  } catch (e) {
    const output = (e.stdout || '') + (e.stderr || '');
    const summary = output.split('\n').filter(l => /fail|error|pass/i.test(l)).slice(0, 5).join('\n');
    return { status: 'fail', message: summary || 'Tests failed' };
  }
}

/**
 * Architecture check — enforces structural rules.
 */
async function checkArchitecture(workspacePath) {
  const warnings = [];

  // Rule 1: No circular imports between shared modules
  const sharedDir = resolve(workspacePath, 'mcp-server', 'shared');
  try {
    const sharedFiles = await readdir(sharedDir);
    const importMap = new Map();
    for (const f of sharedFiles.filter(f => f.endsWith('.js'))) {
      const content = await readFile(resolve(sharedDir, f), 'utf-8');
      const imports = [...content.matchAll(/from\s+['"]\.\/([\w-]+)\.js['"]/g)].map(m => m[1]);
      importMap.set(f.replace('.js', ''), imports);
    }
    // Simple cycle detection among shared modules
    for (const [mod, deps] of importMap) {
      for (const dep of deps) {
        if (importMap.get(dep)?.includes(mod)) {
          warnings.push(`Circular import: ${mod} ↔ ${dep}`);
        }
      }
    }
  } catch { /* shared dir may not exist */ }

  // Rule 2: Server file shouldn't exceed reasonable LOC
  try {
    const serverFile = resolve(workspacePath, 'battle-log', 'server.js');
    const content = await readFile(serverFile, 'utf-8');
    const lines = content.split('\n').length;
    if (lines > 800) {
      warnings.push(`server.js is ${lines} lines — consider splitting into route modules`);
    }
  } catch { /* server may not exist */ }

  if (warnings.length > 0) {
    return { status: 'warn', message: warnings.join('; ') };
  }
  return { status: 'pass', message: 'Architecture rules satisfied' };
}

/**
 * Security check — basic static analysis for common issues.
 */
async function checkSecurity(workspacePath) {
  const issues = [];
  const files = await findJSFiles(workspacePath);

  for (const file of files.slice(0, 50)) { // cap for performance
    try {
      const content = await readFile(file, 'utf-8');
      // Check for eval usage
      if (/\beval\s*\(/.test(content)) {
        issues.push(`${file}: eval() usage detected`);
      }
      // Check for hardcoded secrets patterns
      if (/(?:password|secret|api_key|token)\s*=\s*['"][^'"]{8,}['"]/i.test(content)) {
        issues.push(`${file}: Possible hardcoded secret`);
      }
    } catch {}
  }

  if (issues.length > 0) {
    return { status: 'warn', message: issues.slice(0, 5).join('; ') };
  }
  return { status: 'pass', message: 'No security issues detected' };
}

// --- Helpers ---

async function findJSFiles(dir, maxDepth = 4, depth = 0) {
  if (depth > maxDepth) return [];
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await findJSFiles(fullPath, maxDepth, depth + 1));
      } else if (JS_EXTENSIONS.has(extname(entry.name))) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

function detectTestCommand(workspacePath) {
  try {
    const pkg = JSON.parse(execSync(`type "${resolve(workspacePath, 'package.json')}"`, { encoding: 'utf-8', stdio: 'pipe', shell: true }));
    if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
      return 'npm test';
    }
  } catch {}

  // Check for test files
  try {
    execSync(`dir /b "${resolve(workspacePath, 'tests')}"`, { encoding: 'utf-8', stdio: 'pipe', shell: true });
    return 'node --test tests/*.test.js';
  } catch {}

  return null;
}

export { checkSyntax, checkTests, checkArchitecture, checkSecurity };

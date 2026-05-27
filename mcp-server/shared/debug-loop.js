/**
 * Autonomous Debug Loop
 *
 * Self-healing error detection and fix pipeline:
 *   1. Detect — Catch errors from test failures, lint, or runtime
 *   2. Classify — Determine error type and appropriate model tier
 *   3. Gather — Collect evidence (stack trace, code region, recent changes)
 *   4. Hypothesize — Model generates fix hypothesis
 *   5. Verify — Run tests to confirm fix
 *   6. Commit or Escalate — If fixed, commit. If stuck, escalate to human.
 *
 * Operates without human intervention for common error patterns.
 * Learns from past fixes via episodic memory integration.
 */

const MAX_RETRIES_DEFAULT = 3;

let debugHistory = []; // past debug sessions
let activeSession = null;

/**
 * Classify an error to determine severity and routing.
 * @param {Object} error - { message, stack, file, line }
 * @returns {{ type: string, tier: string, maxRetries: number, autoFixable: boolean }}
 */
export function classifyError(error) {
  const message = (error.message || error.toString()).toLowerCase();

  if (/typeerror|is not a function|undefined is not|cannot read prop/.test(message)) {
    return { type: 'type_error', tier: 'fast', maxRetries: 2, autoFixable: true };
  }
  if (/cannot find module|module not found|importerror|no such file/.test(message)) {
    return { type: 'import_error', tier: 'fast', maxRetries: 1, autoFixable: true };
  }
  if (/assertion|expected.*but got|assertionerror/.test(message)) {
    return { type: 'logic_error', tier: 'reasoning', maxRetries: 3, autoFixable: true };
  }
  if (/timeout|econnrefused|race condition|deadlock|eaddrinuse/.test(message)) {
    return { type: 'async_error', tier: 'reasoning', maxRetries: 2, autoFixable: false };
  }
  if (/syntaxerror|unexpected token|unexpected end/.test(message)) {
    return { type: 'syntax_error', tier: 'fast', maxRetries: 1, autoFixable: true };
  }
  if (/referenceerror|is not defined/.test(message)) {
    return { type: 'reference_error', tier: 'fast', maxRetries: 2, autoFixable: true };
  }
  if (/rangeerror|maximum call stack|out of memory/.test(message)) {
    return { type: 'resource_error', tier: 'specialist', maxRetries: 1, autoFixable: false };
  }
  return { type: 'unknown', tier: 'specialist', maxRetries: 2, autoFixable: false };
}

/**
 * Gather evidence for debugging.
 * @param {Object} error - Error details
 * @param {Object} [opts] - { fileContent, recentChanges, relatedFiles, similarFixes }
 * @returns {Object} Structured evidence package
 */
export function gatherEvidence(error, opts = {}) {
  const evidence = {
    stackTrace: error.stack || null,
    message: error.message || String(error),
    file: error.file || null,
    line: error.line || null,
    codeRegion: null,
    recentChanges: opts.recentChanges || null,
    relatedFiles: opts.relatedFiles || [],
    similarFixes: opts.similarFixes || [],
    previousAttempts: [],
  };

  // Extract code region around error line
  if (opts.fileContent && error.line) {
    const lines = opts.fileContent.split('\n');
    const start = Math.max(0, error.line - 8);
    const end = Math.min(lines.length, error.line + 8);
    evidence.codeRegion = lines.slice(start, end).map((l, i) => {
      const lineNum = start + i + 1;
      const marker = lineNum === error.line ? '>>>' : '   ';
      return `${marker} ${lineNum}: ${l}`;
    }).join('\n');
  }

  return evidence;
}

/**
 * Generate a fix prompt for the model.
 * @param {Object} classification - From classifyError()
 * @param {Object} evidence - From gatherEvidence()
 * @param {number} attempt - Current attempt number (0-based)
 * @returns {string} Prompt for the model
 */
export function buildFixPrompt(classification, evidence, attempt) {
  const parts = [
    `You are debugging a ${classification.type} in a Node.js/JavaScript project.`,
    `Error: ${evidence.message}`,
  ];

  if (evidence.file) parts.push(`File: ${evidence.file}`);
  if (evidence.codeRegion) parts.push(`\nCode region:\n\`\`\`\n${evidence.codeRegion}\n\`\`\``);
  if (evidence.stackTrace) parts.push(`\nStack trace:\n${evidence.stackTrace.slice(0, 500)}`);
  if (evidence.recentChanges) parts.push(`\nRecent changes:\n${evidence.recentChanges.slice(0, 500)}`);
  if (evidence.relatedFiles.length) parts.push(`\nRelated files: ${evidence.relatedFiles.join(', ')}`);

  if (evidence.previousAttempts.length > 0) {
    parts.push(`\n⚠️ Previous ${evidence.previousAttempts.length} fix attempt(s) FAILED:`);
    for (const prev of evidence.previousAttempts) {
      parts.push(`- Tried: ${prev.fix} → Result: ${prev.result}`);
    }
    parts.push('Do NOT repeat these approaches. Try a fundamentally different fix.');
  }

  if (evidence.similarFixes.length > 0) {
    parts.push(`\n💡 Similar past fixes that worked:`);
    for (const fix of evidence.similarFixes.slice(0, 3)) {
      parts.push(`- ${fix}`);
    }
  }

  parts.push(`\nProvide a concrete fix. Respond with:`);
  parts.push(`1. DIAGNOSIS: One sentence root cause`);
  parts.push(`2. FIX: The corrected code (minimal change only)`);
  parts.push(`3. CONFIDENCE: high/medium/low`);

  return parts.join('\n');
}

/**
 * Start a debug session.
 * @param {Object} error - Error to debug
 * @param {Object} [opts] - Evidence options
 * @returns {Object} Session state
 */
export function startDebugSession(error, opts = {}) {
  const classification = classifyError(error);
  const evidence = gatherEvidence(error, opts);

  activeSession = {
    id: `debug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    error,
    classification,
    evidence,
    attempts: [],
    status: 'active', // active | resolved | escalated
    startedAt: Date.now(),
    resolvedAt: null,
  };

  return activeSession;
}

/**
 * Record a fix attempt result.
 * @param {string} fixDescription - What was tried
 * @param {boolean} success - Did tests pass?
 * @param {string} [testOutput] - Test failure details
 * @returns {Object} Updated session
 */
export function recordAttempt(fixDescription, success, testOutput = '') {
  if (!activeSession) return null;

  activeSession.attempts.push({
    fix: fixDescription,
    success,
    testOutput: testOutput.slice(0, 500),
    timestamp: Date.now(),
  });

  if (success) {
    activeSession.status = 'resolved';
    activeSession.resolvedAt = Date.now();
    debugHistory.push({ ...activeSession });
    const resolved = activeSession;
    activeSession = null;
    return resolved;
  }

  // Check if we should escalate
  if (activeSession.attempts.length >= activeSession.classification.maxRetries) {
    activeSession.status = 'escalated';
    debugHistory.push({ ...activeSession });
    const escalated = activeSession;
    activeSession = null;
    return escalated;
  }

  // Add to evidence for next attempt
  activeSession.evidence.previousAttempts.push({
    fix: fixDescription,
    result: testOutput.slice(0, 200),
  });

  // Escalate tier if needed
  if (activeSession.attempts.length >= 2 && activeSession.classification.tier !== 'reasoning') {
    activeSession.classification.tier = 'reasoning';
  }

  return activeSession;
}

/**
 * Get the next fix prompt for the active session.
 * @returns {string|null}
 */
export function getNextFixPrompt() {
  if (!activeSession || activeSession.status !== 'active') return null;
  return buildFixPrompt(
    activeSession.classification,
    activeSession.evidence,
    activeSession.attempts.length
  );
}

/**
 * Get debug loop statistics.
 */
export function getDebugStats() {
  const resolved = debugHistory.filter(s => s.status === 'resolved');
  const escalated = debugHistory.filter(s => s.status === 'escalated');

  const byType = {};
  for (const s of debugHistory) {
    const t = s.classification.type;
    if (!byType[t]) byType[t] = { total: 0, resolved: 0, avgAttempts: 0, totalAttempts: 0 };
    byType[t].total++;
    if (s.status === 'resolved') byType[t].resolved++;
    byType[t].totalAttempts += s.attempts.length;
  }
  for (const t of Object.keys(byType)) {
    byType[t].avgAttempts = byType[t].total > 0
      ? Math.round((byType[t].totalAttempts / byType[t].total) * 10) / 10
      : 0;
  }

  return {
    totalSessions: debugHistory.length,
    resolved: resolved.length,
    escalated: escalated.length,
    successRate: debugHistory.length > 0
      ? Math.round((resolved.length / debugHistory.length) * 100) / 100
      : 0,
    avgAttemptsToResolve: resolved.length > 0
      ? Math.round((resolved.reduce((s, r) => s + r.attempts.length, 0) / resolved.length) * 10) / 10
      : 0,
    byErrorType: byType,
    activeSession: activeSession ? { id: activeSession.id, type: activeSession.classification.type, attempts: activeSession.attempts.length } : null,
  };
}

/**
 * Get session history for visualization.
 */
export function getDebugHistory() {
  return debugHistory.slice(-20).map(s => ({
    id: s.id,
    type: s.classification.type,
    tier: s.classification.tier,
    status: s.status,
    attempts: s.attempts.length,
    error: s.error.message?.slice(0, 100),
    duration: s.resolvedAt ? s.resolvedAt - s.startedAt : null,
  }));
}

/**
 * Reset state (for testing).
 */
export function resetDebugLoop() {
  debugHistory = [];
  activeSession = null;
}

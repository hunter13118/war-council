/**
 * Retry wrapper with exponential backoff.
 */
export async function withRetry(fn, opts = {}) {
  const { maxRetries = 3, baseDelayMs = 1000, label = "operation" } = opts;
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        process.stderr.write(
          `[war-council] ${label} attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in ${delay}ms...\n`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(
    `${label} failed after ${maxRetries} attempts. Last error: ${lastError.message}`
  );
}

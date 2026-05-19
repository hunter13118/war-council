/**
 * Shell command runner — safe subprocess execution.
 */
import { spawn } from "node:child_process";

export function runCommand(command, args, cwd, timeoutMs = 600_000) {
  return new Promise((resolvePromise) => {
    const t0 = Date.now();
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        stdout,
        stderr,
        elapsedMs: Date.now() - t0,
        timedOut: killed,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: -1,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        elapsedMs: Date.now() - t0,
        timedOut: false,
      });
    });
  });
}

#!/usr/bin/env node
/**
 * Fail closed on drizzle-kit 0.31.x phantom DDL, including its reported SQL
 * exceptions with exit code ZERO. Only the guarded, empty disposable PG18 CI
 * may invoke a repeat push; never enable this action for Neon/production.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDisposablePG18Environment } from "./fresh-pg18-development-schema.mjs";

export function classifyDrizzleRepeatPush(exitCode, stdout, stderr) {
  const combined = String(stdout ?? "") + "\n" + String(stderr ?? "");
  if (exitCode !== 0) throw new Error("PG18_REPEAT_PUSH_NONZERO_EXIT");
  if (/(^|\n)\s*(?:error|fatal|exception)\s*:|error\s*\[|error\s*\(|\b(?:unhandled|failed to execute)\b/i.test(combined)) {
    throw new Error("PG18_REPEAT_PUSH_REPORTED_ERROR");
  }
  if (!/\bno changes detected\b/i.test(combined) ||
      /\bchanges applied\b|\balter table\b|\bdrop constraint\b|\bcreate table\b/i.test(combined)) {
    throw new Error("PG18_REPEAT_PUSH_PHANTOM_DDL_OR_UNPROVEN_NOOP");
  }
  return true;
}

export async function runStrictRepeatPush(env = process.env) {
  assertDisposablePG18Environment(env);
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(executable, ["run","db:push"], {
    shell:false,env,stdio:["ignore","pipe","pipe"],
  });
  const MAX_LOG_BYTES = 512_000;
  let stdout = "", stderr = "", oversized = false, launchError = false;
  for (const [stream, which] of [[child.stdout, "out"],[child.stderr,"err"]]) {
    stream.on("data", chunk => {
      const text = chunk.toString("utf8");
      if (which === "out") stdout += text; else stderr += text;
      if (stdout.length + stderr.length > MAX_LOG_BYTES) {
        oversized = true;
        child.kill();
      }
    });
  }
  child.on("error", () => { launchError = true; });
  const code = await new Promise(resolve => child.once("close", resolve));
  // Don't echo potentially sensitive driver error details; only a stable code.
  if (launchError || oversized) throw new Error("PG18_REPEAT_PUSH_RUNNER_FAILED");
  classifyDrizzleRepeatPush(code, stdout, stderr);
  process.stdout.write("PG18_REPEAT_PUSH_STRICT_NO_OP: PASS (Drizzle reported no DDL and no errors)\n");
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runStrictRepeatPush().catch(error => {
    const code = error instanceof Error && /^PG18_REPEAT_PUSH_[A-Z_]+$/.test(error.message)
      ? error.message : "PG18_REPEAT_PUSH_EXECUTION_FAILED";
    process.stderr.write(code+"\n");
    process.exitCode = 1;
  });
}

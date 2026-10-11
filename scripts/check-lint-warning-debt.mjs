import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Warning ceilings never suppress a rule or excuse an ESLint error. */
export function warningDebt(results, baseline, root) {
  const counts = new Map();
  for (const result of results) {
    const file = relative(root, result.filePath).replaceAll("\\", "/");
    for (const message of result.messages) {
      if (message.severity !== 1) continue;
      const rule = message.ruleId ?? "unknown";
      const key = JSON.stringify([file, rule]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const failures = [];
  for (const [key, count] of counts) {
    const [file, rule] = JSON.parse(key);
    const allowed = baseline[file]?.[rule] ?? 0;
    if (count > allowed) failures.push(`${file}: ${rule}: ${count} warnings exceeds baseline ${allowed}`);
  }
  return failures;
}

function main() {
  const root = process.cwd();
  const require = createRequire(import.meta.url);
  const cli = resolve(dirname(require.resolve("eslint/package.json")), "bin/eslint.js");
  // Use the native CLI so ESLint's counted bulk suppressions and unused
  // suppression checks behave exactly as they did under `eslint .`.
  const run = spawnSync(process.execPath, [cli, ".", "--format", "json"], {
    cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  if (run.error || run.signal) throw run.error ?? new Error(`ESLint stopped: ${run.signal}`);
  if (run.stderr) process.stderr.write(run.stderr);
  let results;
  try { results = JSON.parse(run.stdout); }
  catch { process.stderr.write(run.stdout); throw new Error("ESLint did not return a valid report."); }
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    errors += result.errorCount;
    warnings += result.warningCount;
    for (const message of result.messages) {
      console.log(`${relative(root, result.filePath)}:${message.line ?? 0}:${message.column ?? 0} ${message.severity === 2 ? "error" : "warning"} ${message.ruleId ?? ""} ${message.message}`);
    }
  }
  const baseline = JSON.parse(readFileSync(resolve(root, "eslint-warning-baseline.json"), "utf8"));
  const failures = warningDebt(results, baseline, root);
  failures.forEach((failure) => console.error(failure));
  console.log(`ESLint: ${errors} errors, ${warnings} warnings; ${failures.length} warning baseline violations.`);
  if (run.status !== 0 || errors || failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}

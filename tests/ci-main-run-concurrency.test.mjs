import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

// The required "check" job fails closed when a regression shard is cancelled
// (see ci-required-check-fail-closed.test.mjs). Cancelling a main-branch run
// because a newer merge landed therefore turned that commit's required check
// red without any test failing. On 2026-10-17, 5d8a69068 and d31b89711 were
// cancelled 3-4 minutes in by the next merge to main.
test("CI never cancels a run for a push to main, but still supersedes PR runs", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const block = workflow.split("\nconcurrency:\n")[1]?.split("\npermissions:")[0] ?? "";
  assert.ok(block, "ci.yml must declare a concurrency block");
  // Cancellation is limited to pull_request events.
  assert.match(block, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.doesNotMatch(block, /cancel-in-progress: true/);
  // Main pushes are keyed by commit, so two merges can never share a group.
  assert.match(block, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.sha \}\}/);
  assert.doesNotMatch(block, /github\.ref \}\}/);
});

// The same defect existed in 16 more workflows that run on push to main
// (CodeQL, security-http-smoke, nav sweep, pilot payroll, ...). On 2026-10-17
// their runs for main commits were cancelled 1-4 minutes in by the next merge,
// so CodeQL and the HTTP security smoke test never completed for those commits.
// Only workflows that merely observe state may keep cancelling superseded runs.
const CANCEL_ALLOWED_ON_MAIN = new Map([
  ["scheduler-scheduled-run-observer.yml",
    "read-only hourly collector; a stale observation is correctly superseded"],
]);

function topLevelBlock(lines, key) {
  const start = lines.findIndex((line) => line === key + ":" || line.startsWith(key + ":"));
  if (start < 0) return [];
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() !== "" && !line.startsWith(" ") && !line.startsWith("\t")) break;
    block.push(line);
  }
  return block;
}

function pushesToMain(lines) {
  const on = topLevelBlock(lines, "on");
  const push = on.findIndex((line) => /^ {2}push:\s*$/.test(line));
  if (push < 0) return false;
  for (let i = push + 1; i < on.length; i += 1) {
    if (/^ {2}\S/.test(on[i])) break; // next trigger
    if (/^ {4}branches:/.test(on[i]) && /\bmain\b/.test(on[i])) return true;
    if (/^ {4}branches:\s*$/.test(on[i])) {
      for (let j = i + 1; j < on.length && /^ {6}/.test(on[j]); j += 1) {
        if (/\bmain\b/.test(on[j])) return true;
      }
    }
  }
  return false;
}

test("no workflow that runs on push to main cancels its own main-branch runs", () => {
  const dir = ".github/workflows";
  const offenders = [];
  let checked = 0;
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".yml"))) {
    const lines = readFileSync(dir + "/" + name, "utf8").split(/\r?\n/);
    if (!pushesToMain(lines)) continue;
    const concurrency = topLevelBlock(lines, "concurrency");
    if (concurrency.length === 0) continue;
    checked += 1;
    const text = concurrency.join("\n");
    const cancelsAlways = /cancel-in-progress:\s*true\b/.test(text);
    const keyedByRefOnly = /group:/.test(text) && /github\.ref\b/.test(text) && !/github\.sha\b/.test(text);
    if (CANCEL_ALLOWED_ON_MAIN.has(name)) continue;
    if (cancelsAlways) offenders.push(name + ": cancel-in-progress: true");
    else if (keyedByRefOnly && /cancel-in-progress:\s*\$\{\{/.test(text)) offenders.push(name + ": keyed by ref");
  }
  assert.ok(checked >= 17, "expected to inspect the push-to-main workflows with concurrency, saw " + checked);
  assert.deepEqual(offenders, [], "cancelled main runs hide CodeQL/security results: " + offenders.join("; "));
});

test("the observer exemption stays real and justified", () => {
  for (const [name, reason] of CANCEL_ALLOWED_ON_MAIN) {
    const text = readFileSync(".github/workflows/" + name, "utf8");
    assert.match(text, /cancel-in-progress:\s*true/, name + " no longer cancels; drop the exemption");
    assert.ok(reason.length > 20);
  }
});

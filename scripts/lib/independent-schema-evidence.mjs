/**
 * Strict, tool-agnostic evidence readers for the source-only #1127 QA workflow.
 * These never connect to a database, waive a finding or create a receipt.
 */
export const ATLAS_SYNCHRONIZED = "Schemas are synced, no changes to be made.";

export function classifyAtlasDiff(stdout) {
  if (typeof stdout !== "string") throw new TypeError("Atlas diff output must be text");
  const text = stdout.trim();
  // With --format '{{ sql . "" }}' current Atlas emits an empty SQL plan for
  // parity; its stock no-change notice is separately recognized for safety.
  if (text === "" || text === ATLAS_SYNCHRONIZED) {
    return { status: "PASS", sqlChanges: false, reason: "ATLAS_NO_SCHEMA_CHANGE" };
  }
  // An unexpected response is also a stop, never an inferred PASS.
  return { status: "DRIFT", sqlChanges: true, reason: "ATLAS_NONEMPTY_OR_UNKNOWN_OUTPUT" };
}

export function classifySquawkReport(stdout, rawExitCode) {
  if (typeof stdout !== "string" || stdout.trim() === "")
    throw new Error("Squawk JSON report is missing");
  if (!Number.isInteger(rawExitCode) || rawExitCode < 0)
    throw new Error("Squawk process exit code is invalid");
  let findings;
  try { findings = JSON.parse(stdout); }
  catch { throw new Error("Squawk JSON report could not be parsed"); }
  if (!Array.isArray(findings)) throw new Error("Squawk JSON reporter format changed");
  if (!findings.every(x => x && typeof x === "object" &&
      typeof x.file === "string" && x.file !== "" &&
      typeof x.rule_name === "string" && x.rule_name !== "" &&
      typeof x.message === "string" && x.message !== "" &&
      ["Warning", "Error"].includes(x.level)))
    throw new Error("Squawk finding has an unexpected shape");
  const byRule = Object.fromEntries([...new Set(findings.map(x => x.rule_name))]
    .sort().map(rule => [rule, findings.filter(x => x.rule_name === rule).length]));
  const bySeverity = Object.fromEntries(["Error", "Warning"].map(level =>
    [level, findings.filter(x => x.level === level).length]));
  return {
    status: rawExitCode === 0 && findings.length === 0 ? "PASS" : "BLOCKED",
    exitCode: rawExitCode, findingCount: findings.length,
    bySeverity, byRule,
    reason: rawExitCode !== 0 ? "SQUAWK_NONZERO_EXIT" :
      findings.length ? "SQUAWK_FINDINGS_REQUIRE_REVIEW" : "NO_SQUAWK_FINDINGS",
  };
}

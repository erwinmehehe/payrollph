/**
 * Verify that a green subprocess actually executed non-skipped TAP tests.
 * A zero-exit runner with no tests, skipped tests or missing summary is NOT proof.
 */
export function evaluateWfmTapResult({ exitCode, output, processError }) {
  const counts = {};
  for (const match of String(output ?? "").matchAll(/^\s*#\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gm)) {
    counts[match[1]] = Number(match[2]);
  }

  const problems = [];
  if (processError || exitCode !== 0) problems.push("test-process-failed");
  if (!["tests", "pass", "fail"].every((name) => Number.isSafeInteger(counts[name]))) {
    problems.push("tap-summary-missing");
  } else {
    if (counts.tests < 1 || counts.pass < 1) problems.push("zero-executed-tests");
    if (counts.pass !== counts.tests || counts.fail !== 0) problems.push("incomplete-or-failed-tests");
  }
  for (const name of ["cancelled", "skipped", "todo"]) {
    if ((counts[name] ?? 0) > 0) problems.push(name + "-tests");
  }

  return {
    passed: problems.length === 0,
    failureKind: problems[0] ?? null,
    tests: counts.tests ?? 0,
    passedTests: counts.pass ?? 0,
    failedTests: counts.fail ?? 0,
    skippedTests: counts.skipped ?? 0,
    todoTests: counts.todo ?? 0,
    cancelledTests: counts.cancelled ?? 0,
  };
}

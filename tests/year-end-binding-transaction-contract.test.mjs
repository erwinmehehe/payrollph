import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-level regression only. Passing this test is NOT a substitute for a
// disposable-PG16 HTTP audit-veto/rollback and concurrency acceptance run.
const yearEnd = readFileSync("src/lib/year-end.ts", "utf8");
const route = readFileSync("src/app/api/year-end/route.ts", "utf8");
const queue = readFileSync("src/lib/payroll-engine.ts", "utf8");

const boundPathIsAtomic = (yearEndSource, routeSource, queueSource) =>
  yearEndSource.includes("YEAR_END_BINDING_REQUIRES_MATCHED_RUN_AND_ATOMIC_CALLBACK")
  && yearEndSource.includes("YEAR_END_UNBOUND_CALLBACK_NOT_ALLOWED")
  && yearEndSource.includes("YEAR_END_BINDING_REQUIRES_DECEMBER_31_CUTOFF")
  && yearEndSource.includes('}, { isolationLevel: "serializable" });')
  && yearEndSource.includes("await options.onBoundToPayrollRun(tx, summary);")
  && yearEndSource.indexOf("await options.onBoundToPayrollRun(tx, summary);")
    < yearEndSource.lastIndexOf('}, { isolationLevel: "serializable" });')
  && routeSource.includes("onBoundToPayrollRun: async (tx, boundSummary) => {")
  && routeSource.includes("await enqueuePayrollRun(boundRun.id, undefined, tx);")
  && routeSource.includes("requiresRecalculation: true,")
  && routeSource.includes("}, tx);")
  && !routeSource.includes("await enqueuePayrollRun(targetRun.id);")
  && queueSource.includes("const connection = transaction ?? db;")
  && queueSource.includes("if (transaction) await queueInTransaction(transaction);")
  && queueSource.includes("else await db.transaction(queueInTransaction);")
  && queueSource.includes("await recordAuditEvent({")
  && queueSource.includes("}, tx);");

test("bound annualization, queue reset and both audits share one serializable transaction", () => {
  assert.ok(boundPathIsAtomic(yearEnd, route, queue),
    "A binding audit or payroll queue must not commit on a separate connection");
});

test("regression guard rejects a split queue or an independently committed audit", () => {
  assert.equal(boundPathIsAtomic(yearEnd, route.replace(
    "await enqueuePayrollRun(boundRun.id, undefined, tx);",
    "await enqueuePayrollRun(boundRun.id);"), queue), false);
  assert.equal(boundPathIsAtomic(yearEnd, route.replace(
    "onBoundToPayrollRun: async (tx, boundSummary) => {",
    "onBoundToPayrollRun: async (boundSummary) => {"), queue), false);
  assert.equal(boundPathIsAtomic(yearEnd.replace(
    "await options.onBoundToPayrollRun(tx, summary);",
    "void options.onBoundToPayrollRun(tx, summary);"), route, queue), false);
  assert.equal(boundPathIsAtomic(yearEnd, route, queue.replace(
    "if (transaction) await queueInTransaction(transaction);",
    "await db.transaction(queueInTransaction);")), false);
});


test("binding options and December cutoff are fail-closed inside the transaction", () => {
  assert.match(yearEnd, /if \(options\.bindToPayrollRunId != null &&\s+\(options\.includePayrollRunId !== options\.bindToPayrollRunId \|\| !options\.onBoundToPayrollRun\)\) \{\s+throw new Error\("YEAR_END_BINDING_REQUIRES_MATCHED_RUN_AND_ATOMIC_CALLBACK"\)/);
  assert.match(yearEnd, /if \(options\.onBoundToPayrollRun && options\.bindToPayrollRunId == null\) \{\s+throw new Error\("YEAR_END_UNBOUND_CALLBACK_NOT_ALLOWED"\)/);
  assert.match(yearEnd, /if \(options\.bindToPayrollRunId != null && !String\(candidate\.periodEnd\)\.endsWith\("-12-31"\)\) \{\s+throw new Error\("YEAR_END_BINDING_REQUIRES_DECEMBER_31_CUTOFF"\)/);
  assert.equal(boundPathIsAtomic(yearEnd.replace("YEAR_END_BINDING_REQUIRES_MATCHED_RUN_AND_ATOMIC_CALLBACK",
    "BINDING_WITHOUT_CALLBACK_ALLOWED"), route, queue), false,
    "a binding may not silently commit without its queue and final audit");
  assert.equal(boundPathIsAtomic(yearEnd.replace("YEAR_END_BINDING_REQUIRES_DECEMBER_31_CUTOFF",
    "CUTOFF_UNVERIFIED"), route, queue), false,
    "the binding cutoff must be revalidated within the serializable snapshot");
});


test("concurrent year-end binding conflicts are 409 without disguising audit vetoes", () => {
  assert.match(route, /candidate\.code === "40001" \|\| candidate\.code === "40P01"/);
  assert.match(route, /if \(boundRun && \(databaseConflict \|\| changedRun\)\)/);
  assert.match(route, /code: "YEAR_END_BINDING_CONFLICT"/);
  assert.match(route, /status: 409, headers: \{ "Cache-Control": "private, no-store" \}/);
  assert.match(route, /throw error;/,
    "unrecognized SQL failures must remain failures instead of false success");
});

// Source-level companion to the PG16 regression in tests/year-end-atomicity.test.ts and the real-HTTP case in
// scripts/qa/year-end-atomic-rollback-pg16.mjs: an approved or run-bound adjustment must never be deleted by a
// later recompute, whatever optional flag or breakdown marker is present.
const recomputeGuardIsUnconditional = (yearEndSource, routeSource) => {
  const guard = 'if (existingAdjustments.some(row => row.status !== "computed" || row.payrollRunId !== null)) {\n    throw new Error("YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED");';
  const unboundMapping = routeSource.indexOf('if (!boundRun && (message.includes("YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED")');
  return yearEndSource.includes(guard)
    && !/row\.payrollRunId !== null\) &&\s*\(usePriorEvidence/.test(yearEndSource)
    && unboundMapping > 0
    && routeSource.includes('code: "YEAR_END_RECOMPUTE_BLOCKED"')
    && unboundMapping < routeSource.indexOf("if (boundRun && (databaseConflict || changedRun))");
};

test("approved or run-bound year-end adjustments are refused unconditionally, with a stable unbound 409", () => {
  assert.ok(recomputeGuardIsUnconditional(yearEnd, route));
  // The earlier guard only fired when a feature flag or breakdown marker was present.
  assert.equal(recomputeGuardIsUnconditional(yearEnd.replace(
    'row.status !== "computed" || row.payrollRunId !== null)) {',
    'row.status !== "computed" || row.payrollRunId !== null) && usePriorEvidence) {'), route), false);
  assert.equal(recomputeGuardIsUnconditional(yearEnd, route.replace(
    'if (!boundRun && (message.includes("YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED")',
    'if (boundRun && (message.includes("YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED")')), false);
  assert.equal(recomputeGuardIsUnconditional(yearEnd, route.replace('code: "YEAR_END_RECOMPUTE_BLOCKED"', 'code: "OTHER"')), false);
  // The settled and prior-evidence rollback guards are preserved.
  assert.match(yearEnd, /have already been settled in payroll and cannot be recomputed in place/);
  assert.match(yearEnd, /PRIOR_EVIDENCE_DISABLED_RECOMPUTE_BLOCKED/);
  assert.match(route, /have already been settled in payroll/);
});

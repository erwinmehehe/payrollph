import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-level regression only. Passing this test is NOT a substitute for a
// disposable-PG16 HTTP audit-veto/rollback and concurrency acceptance run.
const yearEnd = readFileSync("src/lib/year-end.ts", "utf8");
const route = readFileSync("src/app/api/year-end/route.ts", "utf8");
const queue = readFileSync("src/lib/payroll-engine.ts", "utf8");

const boundPathIsAtomic = (yearEndSource, routeSource, queueSource) =>
  yearEndSource.includes('}, { isolationLevel: "serializable" });')
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
    "onBoundToPayrollRun: async (tx, boundSummary) => { /* removed */"), queue), false);
  assert.equal(boundPathIsAtomic(yearEnd.replace(
    "await options.onBoundToPayrollRun(tx, summary);",
    "void options.onBoundToPayrollRun(tx, summary);"), route, queue), false);
  assert.equal(boundPathIsAtomic(yearEnd, route, queue.replace(
    "if (transaction) await queueInTransaction(transaction);",
    "await db.transaction(queueInTransaction);")), false);
});

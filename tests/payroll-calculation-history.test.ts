import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import {
  createPayrollCalculationEvidence,
  verifyPayrollCalculationEvidence,
  type PayrollCalculationEvidence,
} from "../src/lib/payroll-calculation-history";

function fixture(): PayrollCalculationEvidence {
  return {
    organizationId: 10,
    legalEntityId: 12,
    payrollRunId: 40,
    payrollJobId: 60,
    employeeId: 21,
    revision: 1,
    previousSnapshotHash: null,
    periodLabel: "Fictional October 1-15",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
    payDate: "2026-10-15",
    ruleVersion: "PH-2026.01",
    grossPay: "12345.67",
    deductions: "2345.67",
    netPay: "10000.00",
    status: "Ready",
    lineItems: [{ code: "BASIC", amount: "12345.67" }, { code: "SSS", amount: "-2345.67" }],
    trace: {
      inputs: ["statutoryRuleVersion=2026-01", "workingDays=11"],
      rules: { sss: "2026.01", tax: "2026.01" },
      payment: {
        employeeName: "Should NOT become duplicated history",
        bankAccount: "enc:v1:fictional-secret",
        mobile: "09999999999",
      },
    },
  };
}

test("F-04: history is disabled by default, explicitly enabled by exact true", () => {
  assert.equal(criticalReleaseFlagEnabled("payrollCalculationHistory", {}), false);
  assert.equal(criticalReleaseFlagEnabled("payrollCalculationHistory",
    { PAYROLL_CALCULATION_HISTORY_ENABLED: "false" }), false);
  assert.equal(criticalReleaseFlagEnabled("payrollCalculationHistory",
    { PAYROLL_CALCULATION_HISTORY_ENABLED: "TRUE" }), false);
  assert.equal(criticalReleaseFlagEnabled("payrollCalculationHistory",
    { PAYROLL_CALCULATION_HISTORY_ENABLED: "true" }), true);
});

test("F-04: equal calculations hash identically through reordered JSONB keys and exclude payment PII", () => {
  const original = createPayrollCalculationEvidence(fixture());
  const reordered = createPayrollCalculationEvidence({
    ...fixture(),
    trace: {
      payment: { bankAccount: "enc:v1:another-key", employeeName: "changed name" },
      rules: { tax: "2026.01", sss: "2026.01" },
      inputs: ["statutoryRuleVersion=2026-01", "workingDays=11"],
    },
  });
  assert.equal(original.snapshotHash.length, 64);
  assert.equal(original.snapshotHash, reordered.snapshotHash);
  const rowWithMetadata = { ...fixture(), id: 999, recordedAt: "2026-10-25T00:00:00Z" };
  assert.equal(createPayrollCalculationEvidence(rowWithMetadata).snapshotHash, original.snapshotHash,
    "Database-generated row metadata must not contaminate the auditable math hash");
  assert.deepEqual(Object.keys(original.trace as object).sort(), ["inputs", "rules"]);
  assert.equal(JSON.stringify(original).includes("fictional-secret"), false);
  assert.equal(verifyPayrollCalculationEvidence(original), true);
  assert.equal(verifyPayrollCalculationEvidence(reordered), true);
});

test("F-04: arithmetic and lineage changes produce different audit hashes", () => {
  const first = createPayrollCalculationEvidence(fixture());
  const second = createPayrollCalculationEvidence({
    ...fixture(), revision: 2, previousSnapshotHash: first.snapshotHash,
  });
  const changed = createPayrollCalculationEvidence({
    ...fixture(), revision: 2, previousSnapshotHash: first.snapshotHash,
    netPay: "9999.99",
  });
  assert.equal(second.previousSnapshotHash, first.snapshotHash);
  assert.notEqual(first.snapshotHash, second.snapshotHash);
  assert.notEqual(changed.snapshotHash, second.snapshotHash);
  assert.equal(verifyPayrollCalculationEvidence({ ...second, netPay: "0.01" }), false);
  assert.equal(verifyPayrollCalculationEvidence({ ...second, snapshotHash: "0".repeat(64) }), false);
});

test("F-04: history rejects unsound identifiers, unrounded monetary evidence, and invalid hashes", () => {
  assert.throws(() => createPayrollCalculationEvidence({ ...fixture(), employeeId: 0 }), /INVALID_IDENTITY/);
  assert.throws(() => createPayrollCalculationEvidence({ ...fixture(), grossPay: "1000.001" }), /INVALID_MONEY/);
  assert.throws(() => createPayrollCalculationEvidence({ ...fixture(), previousSnapshotHash: "abc" }), /INVALID_PREVIOUS_HASH/);
  assert.throws(() => createPayrollCalculationEvidence({ ...fixture(), trace: [] }), /INVALID_TRACE/);
});

test("F-04: a claimed worker records entire chunks atomically; previews never write", () => {
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  const target = engine.slice(engine.indexOf("async function executePayrollChunk("),
    engine.indexOf("async function finalizeRun("));
  assert.match(target, /if \(input\.preview\) return \{ previewRows \};/);
  const earlyReturn = target.indexOf("if (input.preview) return { previewRows };");
  const transaction = target.indexOf("await db.transaction(async (tx) => {");
  assert.ok(earlyReturn > 0 && transaction > earlyReturn);
  const transacted = target.slice(transaction);
  for (const expression of [
    "await tx.insert(payrollCalculationHistory).values(history)",
    "await tx.insert(payrollEntries).values(entryValues)",
    "await tx.insert(payslips).values(",
    "await tx.update(payrollRuns).set(",
    "await tx.update(payrollJobs).set(",
  ]) assert.ok(transacted.includes(expression), "Missing atomic write: " + expression);
  assert.ok(!target.includes("await db.insert(payrollEntries).values("));
  assert.ok(!target.includes("await db.insert(payslips).values("));
  assert.ok(target.includes("PAYROLL_HISTORY_RUN_CHANGED_OR_CHUNK_REPLAY"));
  assert.ok(target.includes("PAYROLL_HISTORY_JOB_CLAIM_LOST"));
  assert.match(target, /if \(preserveHistory\) \{/);
});

test("F-04: paginated GET history inherits all run, role, org-unit and legal-employer checks", () => {
  const route = readFileSync("src/app/api/payroll-runs/route.ts", "utf8");
  const start = route.indexOf('if (runId > 0) {');
  const end = route.indexOf('const status = await getPayrollJobStatus(runId)', start);
  const segment = route.slice(start, end);
  const beforeHistory = segment.slice(0, segment.indexOf('if (searchParams.get("include") === "history")'));
  for (const gate of ["assertOrganizationRole", "assertOrganizationUnitAccess",
    "resolveMultiEntityContext", "assertEntityResource"]) {
    assert.ok(beforeHistory.includes(gate), gate + " must execute before history SELECT");
  }
  assert.ok(segment.includes('criticalReleaseFlagEnabled("payrollCalculationHistory")'));
  assert.match(segment, /\.limit\(101\)/);
  assert.match(segment, /eq\(payrollCalculationHistory\.organizationId, target\.organizationId\)/);
  assert.match(segment, /eq\(payrollCalculationHistory\.legalEntityId, target\.legalEntityId\)/);
});

test("F-04: SQL source denies UPDATE, DELETE and TRUNCATE, validates chain, grants append-only DML", () => {
  const source = readFileSync("drizzle/0137_immutable_payroll_calculation_history.sql", "utf8");
  assert.match(source, /BEFORE INSERT ON public\.payroll_calculation_history/);
  assert.match(source, /BEFORE UPDATE OR DELETE ON public\.payroll_calculation_history/);
  assert.match(source, /BEFORE TRUNCATE ON public\.payroll_calculation_history/);
  assert.match(source, /GRANT SELECT, INSERT ON public\.payroll_calculation_history TO payrollph_app/);
  assert.match(source, /PAYROLL_HISTORY_SCOPE_OR_SOURCE_MISMATCH/);
  assert.match(source, /PAYROLL_HISTORY_REVISION_CHAIN_INVALID/);
  assert.doesNotMatch(source, /GRANT SELECT, INSERT, UPDATE, DELETE/);
});

test("F-04: tenant history read proof is independently pinned to a populated own/foreign HTTP fixture", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8")) as {
    allApiRouteFiles: Record<string, { methods: Array<{ name: string;
      historyReadProof?: { file: string; seedLine: number; ownPositiveLine: number;
        ownRowAssertionLine: number; foreignDenialLine: number; ownStatus: number;
        foreignStatus: number; } }> }>;
  };
  const get = manifest.allApiRouteFiles["src/app/api/payroll-runs/route.ts"].methods
    .find((method) => method.name === "GET");
  const proof = get?.historyReadProof;
  assert.ok(proof, "F-04 history cannot borrow only the existing payroll-list tenant proof");
  assert.equal(proof.file, "scripts/qa/tenant-second-pass-http.mjs");
  assert.equal(proof.ownStatus, 200);
  assert.equal(proof.foreignStatus, 403);
  const lines = readFileSync(proof.file, "utf8").split("\n");
  assert.match(lines[proof.seedLine - 1], /historyRows = await db.insert\(payrollCalculationHistory\)/);
  const own = lines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 3).join("\n");
  assert.match(own, /const ownHistory = expectStatus\(await request\(/);
  assert.match(own, /&include=history/);
  assert.match(own, /\{ cookie: attackerCookie \}\), 200/);
  assert.match(lines[proof.ownRowAssertionLine - 1], /f\.historyRows\[idx\]\.id, \[f\.historyRows\[0\]\.id\]/);
  const denied = lines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 4).join("\n");
  assert.match(denied, /f\.victimRun\.id \+ "&include=history"/);
  assert.match(denied, /\{ cookie: attackerCookie \}\), 403/);
  assert.match(readFileSync(".github/workflows/security-http-smoke.yml", "utf8"),
    /PAYROLL_CALCULATION_HISTORY_ENABLED: "true"/);
});

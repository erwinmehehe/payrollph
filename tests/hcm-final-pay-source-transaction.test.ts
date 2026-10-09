import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations } from "../src/db/schema";
import { finalPaySourceFingerprint, type FinalPayFingerprintInputs } from "../src/lib/final-pay-source-fingerprint";
import {
  FINAL_PAY_CONCURRENT_SOURCE_CONFLICT,
  isRetryableFinalPayConflict,
} from "../src/lib/final-pay-transaction-guard";

function fixture(): FinalPayFingerprintInputs {
  return {
    employee: {
      status: "Separating", basicRate: "30000.00", mwe: false,
      orgUnitId: 2, legalEntityId: 1, employmentType: "Regular", startDate: "2023-01-01",
    },
    payProfile: {
      id: 51, payBasis: "monthly", rateAmount: "30000.00",
      standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    released: [
      {
        runId: 112, entryId: 312, grossPay: "15000.00",
        periodStart: "2026-09-16", periodEnd: "2026-09-30", payDate: "2026-09-30",
        lineItems: [{ code: "BASIC", amount: "15000.00" }],
        trace: { inputs: ["taxPeriod=2026-09"] },
      },
      {
        runId: 111, entryId: 311, grossPay: "15000.00",
        periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-15",
        lineItems: [{ code: "BASIC", amount: "15000.00" }], trace: {},
      },
    ],
    historical: [
      {
        id: 22, grossPay: "13000.00", basicSalary: "12000.00",
        thirteenthMonth: "1000.00", taxWithheld: "350.00",
        sssEmployee: "400.00", philHealthEmployee: "300.00", pagIbigEmployee: "200.00",
        payDate: "2026-02-28",
      },
      {
        id: 21, grossPay: "12000.00", basicSalary: "12000.00",
        thirteenthMonth: "0.00", taxWithheld: "300.00",
        sssEmployee: "400.00", philHealthEmployee: "300.00", pagIbigEmployee: "200.00",
        payDate: "2026-01-31",
      },
    ],
    loans: [
      { id: 92, loanType: "Company", totalPaid: "125.00", remainingBalance: "875.00", status: "active" },
      { id: 91, loanType: "SSS", totalPaid: "250.00", remainingBalance: "750.00", status: "active" },
    ],
  };
}

function snapshot(f: FinalPayFingerprintInputs) {
  return JSON.stringify(finalPaySourceFingerprint(f));
}

test("final-pay fingerprint is deterministically sorted without modifying source ordering", () => {
  const source = fixture();
  const releasedOrder = source.released.map(row => row.entryId);
  const historicOrder = source.historical.map(row => row.id);
  const loanOrder = source.loans.map(row => row.id);
  const expected = snapshot(source);
  const permuted = {
    ...source,
    released: [...source.released].reverse(),
    historical: [...source.historical].reverse(),
    loans: [...source.loans].reverse(),
  };
  assert.equal(snapshot(permuted), expected);
  assert.deepEqual(source.released.map(row => row.entryId), releasedOrder);
  assert.deepEqual(source.historical.map(row => row.id), historicOrder);
  assert.deepEqual(source.loans.map(row => row.id), loanOrder);
});

test("frozen final-pay evidence detects source changes to MWE, statutory YTD, bank-relevant loan and payroll inputs", () => {
  const initial = fixture();
  const expected = snapshot(initial);
  const mutations: Array<[string, (value: FinalPayFingerprintInputs) => void]> = [
    ["MWE classification", v => { v.employee.mwe = true; }],
    ["worker org unit", v => { v.employee.orgUnitId = 7; }],
    ["worker legal employer", v => { v.employee.legalEntityId = 5; }],
    ["employment date", v => { v.employee.startDate = "2024-01-01"; }],
    ["pay profile rate", v => { v.payProfile.rateAmount = "30500.00"; }],
    ["pay profile updated at", v => { v.payProfile.updatedAt = "2026-10-01T00:00:00.000Z"; }],
    ["released payroll gross", v => { v.released[0].grossPay = "15500.00"; }],
    ["released payroll tax trace", v => { v.released[0].trace = { inputs: ["taxPeriod=changed"] }; }],
    ["released payroll cutoff", v => { v.released[0].periodEnd = "2026-10-01"; }],
    ["historical tax withheld", v => { v.historical[0].taxWithheld = "351.00"; }],
    ["historical SSS employee", v => { v.historical[0].sssEmployee = "401.00"; }],
    ["historical PhilHealth employee", v => { v.historical[0].philHealthEmployee = "301.00"; }],
    ["historical Pag-IBIG employee", v => { v.historical[0].pagIbigEmployee = "201.00"; }],
    ["loan total already paid", v => { v.loans[0].totalPaid = "126.00"; }],
    ["loan remaining balance", v => { v.loans[1].remainingBalance = "749.00"; }],
    ["loan type priority", v => { v.loans[0].loanType = "Pag-IBIG"; }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = fixture();
    mutate(changed);
    assert.notEqual(snapshot(changed), expected, label);
  }
});

test("retryable PostgreSQL serialization/deadlock errors are detected through nested Drizzle causes", () => {
  assert.equal(isRetryableFinalPayConflict({ code: "40001" }), true);
  assert.equal(isRetryableFinalPayConflict({ cause: { code: "40P01" } }), true);
  assert.equal(isRetryableFinalPayConflict({ cause: { cause: { code: "40001" } } }), true);
  assert.equal(isRetryableFinalPayConflict({ code: "23514" }), false);
  assert.equal(isRetryableFinalPayConflict(new Error("unavailable")), false);
  const circular: { cause?: unknown } = {};
  circular.cause = circular;
  assert.equal(isRetryableFinalPayConflict(circular), false);
  assert.equal(FINAL_PAY_CONCURRENT_SOURCE_CONFLICT.code, "FINAL_PAY_CONCURRENT_SOURCE_CONFLICT");
});


test("synthetic PostgreSQL SERIALIZABLE read/write conflict rolls back an obsolete employee status transition", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Final-pay source concurrency QA",
    legalName: "Final-pay source concurrency QA",
    plan: "Core",
  }).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: `FP-SOURCE-${randomUUID().slice(0, 8)}`,
      firstName: "Ledger", lastName: "Tester", title: "Staff",
      avatarInitials: "LT", basicRate: "30000.00",
      startDate: "2025-01-01", status: "Separating",
    }).returning();
    let caught: unknown = null;
    try {
      await db.transaction(async tx => {
        const [initial] = await tx.select().from(employees)
          .where(eq(employees.id, worker.id)).limit(1);
        assert.equal(initial.status, "Separating");

        // A different pooled connection commits a new pay source AFTER
        // this transaction's serializable snapshot is created.
        await db.update(employees).set({ basicRate: "30001.00" })
          .where(eq(employees.id, worker.id));

        // Updating the stale tuple must fail, not silently mark separated
        // based on an obsolete payroll input snapshot.
        await tx.update(employees).set({ status: "Separated" })
          .where(eq(employees.id, worker.id));
      }, { isolationLevel: "serializable" });
    } catch (error) {
      caught = error;
    }
    assert.ok(isRetryableFinalPayConflict(caught), "Expected PostgreSQL 40001 on stale serializable source write.");
    const [fresh] = await db.select().from(employees).where(eq(employees.id, worker.id));
    assert.equal(fresh.status, "Separating", "Failed money decision must not commit worker status.");
    assert.equal(fresh.basicRate, "30001.00", "Independent source writer's committed value is preserved.");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("all three source-money decisions read from their own transaction and never retry themselves", () => {
  const api = readFileSync("src/app/api/separation/route.ts", "utf8");
  const loader = api.slice(api.indexOf("async function loadFinalPaySources("),api.indexOf("function sameSnapshot("));
  assert.ok(loader.includes('executor?: Pick<typeof db, "select">'));
  assert.ok(loader.includes("options.skipSchemaSetup"));
  assert.ok(loader.includes("const reader = options.executor ?? db"));
  assert.ok(!loader.includes("await db.select("));
  assert.equal((api.match(/const transactionSources = await loadFinalPaySources\(/g) ?? []).length, 3);
  assert.equal((api.match(/isolationLevel: "serializable"/g) ?? []).length, 3);
  assert.ok(api.includes("const orderedLoans = [...transactionSources.loans]"));
  assert.ok(api.includes("isRetryableFinalPayConflict(error)"));
  assert.ok(api.includes("FINAL_PAY_CONCURRENT_SOURCE_CONFLICT"));
  assert.ok(api.includes("skipSchemaSetup: true"));
  assert.ok(api.includes('finalPaySourceFingerprint as fingerprint'));
  assert.ok(api.includes('process.env.FINAL_PAY_MANUAL_RELEASE_ENABLED !== "true"'));
});

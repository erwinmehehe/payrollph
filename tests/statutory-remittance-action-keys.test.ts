import assert from "node:assert/strict";
import test from "node:test";
import { buildStatutoryRemittanceAlerts } from "../src/lib/statutory-remittance-alerts";
import { statutoryLiabilityKeys } from "../src/lib/statutory-remittance-state";

test("remittance alerts keep stable source keys as severity changes", () => {
  const dueSoon = buildStatutoryRemittanceAlerts({
    today: "2026-10-25",
    coverageGaps: [],
    batches: [{
      id: 41,
      agency: "SSS",
      applicableMonth: "2026-09",
      dueDate: "2026-10-31",
      status: "open",
      pendingPostingCount: 12,
      exceptionCount: 0,
    }],
  });
  const overdue = buildStatutoryRemittanceAlerts({
    today: "2026-11-01",
    coverageGaps: [],
    batches: [{
      id: 41,
      agency: "SSS",
      applicableMonth: "2026-09",
      dueDate: "2026-10-31",
      status: "open",
      pendingPostingCount: 12,
      exceptionCount: 0,
    }],
  });

  assert.equal(dueSoon[0].id, "batch:41");
  assert.equal(overdue[0].id, "batch:41");
  assert.notEqual(dueSoon[0].title, overdue[0].title);
});

test("coverage gap key is stable for one agency and month", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-20",
    batches: [],
    coverageGaps: [{
      agency: "PhilHealth",
      applicableMonth: "2026-09",
      dueDate: "2026-10-15",
    }],
  });
  assert.equal(alerts[0].id, "coverage:PhilHealth:2026-09");
});


test("missing-remittance coverage is created only for agencies with real payroll liability", () => {
  const keys = statutoryLiabilityKeys({
    runMonths: {
      1: "2026-09",
      2: "2026-10",
    },
    entries: [
      {
        payrollRunId: 1,
        employeeId: 10,
        lineItems: [{ code: "SSS", amount: -750 }],
        trace: { inputs: ["sssEmployerCutoff=1500.00", "sssEmployerEcCutoff=30.00"] },
      },
      {
        payrollRunId: 2,
        employeeId: 11,
        lineItems: [{ code: "PHIC", amount: -375 }],
        trace: { inputs: ["philHealthEmployerCutoff=375.00"] },
      },
    ],
  });

  assert.equal(keys.has("2026-09|SSS"), true);
  assert.equal(keys.has("2026-09|PhilHealth"), false);
  assert.equal(keys.has("2026-09|Pag-IBIG"), false);
  assert.equal(keys.has("2026-10|PhilHealth"), true);
  assert.equal(keys.has("2026-10|SSS"), false);
});

test("zero statutory contribution entries do not create false compliance gaps", () => {
  const keys = statutoryLiabilityKeys({
    runMonths: { 3: "2026-09" },
    entries: [{
      payrollRunId: 3,
      employeeId: 12,
      lineItems: [],
      trace: { inputs: [] },
    }],
  });

  assert.deepEqual([...keys], []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildStatutoryRemittanceAlerts } from "../src/lib/statutory-remittance-alerts";

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

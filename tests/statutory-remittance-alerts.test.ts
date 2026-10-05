import assert from "node:assert/strict";
import test from "node:test";
import { buildStatutoryRemittanceAlerts, daysUntil } from "../src/lib/statutory-remittance-alerts";

test("daysUntil uses calendar dates without local timezone drift", () => {
  assert.equal(daysUntil("2026-10-15", "2026-10-05"), 10);
  assert.equal(daysUntil("2026-10-05", "2026-10-05"), 0);
  assert.equal(daysUntil("2026-10-04", "2026-10-05"), -1);
});

test("missing remittance control becomes danger once the deadline passes", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-20",
    batches: [],
    coverageGaps: [{
      agency: "SSS",
      applicableMonth: "2026-08",
      dueDate: "2026-09-30",
    }],
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].tone, "danger");
  assert.match(alerts[0].title, /missing and overdue/i);
});

test("open remittance due within seven days is proactively warned", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-10",
    coverageGaps: [],
    batches: [{
      id: 1,
      agency: "PhilHealth",
      applicableMonth: "2026-09",
      dueDate: "2026-10-15",
      status: "open",
      pendingPostingCount: 10,
      exceptionCount: 0,
    }],
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].tone, "warning");
  assert.match(alerts[0].detail, /5 days/i);
});

test("paid remittance remains warning until every employee posting is confirmed", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-20",
    coverageGaps: [],
    batches: [{
      id: 2,
      agency: "Pag-IBIG",
      applicableMonth: "2026-09",
      dueDate: "2026-10-19",
      status: "paid",
      pendingPostingCount: 3,
      exceptionCount: 0,
    }],
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].tone, "warning");
  assert.match(alerts[0].title, /posting still unconfirmed/i);
});

test("employee posting exceptions outrank ordinary warnings", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-10",
    coverageGaps: [{
      agency: "SSS",
      applicableMonth: "2026-09",
      dueDate: "2026-10-31",
    }],
    batches: [{
      id: 3,
      agency: "PhilHealth",
      applicableMonth: "2026-09",
      dueDate: "2026-10-15",
      status: "exception",
      pendingPostingCount: 0,
      exceptionCount: 1,
    }],
  });

  assert.equal(alerts[0].tone, "danger");
  assert.match(alerts[0].title, /posting exceptions/i);
});

test("reconciled batches do not create alerts", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-20",
    coverageGaps: [],
    batches: [{
      id: 4,
      agency: "SSS",
      applicableMonth: "2026-09",
      dueDate: "2026-10-31",
      status: "reconciled",
      pendingPostingCount: 0,
      exceptionCount: 0,
    }],
  });
  assert.deepEqual(alerts, []);
});


test("paid batch without active hashed proof creates a critical evidence alert", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-20",
    coverageGaps: [],
    batches: [{
      id: 91,
      agency: "SSS",
      applicableMonth: "2026-09",
      dueDate: "2026-10-31",
      status: "paid",
      pendingPostingCount: 0,
      exceptionCount: 0,
      hasActivePaymentProof: false,
    }],
  });
  const proof = alerts.find((alert) => alert.id === "proof:91");
  assert.ok(proof);
  assert.equal(proof.tone, "danger");
  assert.match(proof.title, /missing hashed proof/i);
});

test("reconciled historical batch without proof still alerts instead of being skipped", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-20",
    coverageGaps: [],
    batches: [{
      id: 92,
      agency: "PhilHealth",
      applicableMonth: "2026-08",
      dueDate: "2026-09-20",
      status: "reconciled",
      pendingPostingCount: 0,
      exceptionCount: 0,
      hasActivePaymentProof: false,
    }],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, "proof:92");
  assert.equal(alerts[0].tone, "danger");
});

test("reconciled batch with active proof remains quiet", () => {
  const alerts = buildStatutoryRemittanceAlerts({
    today: "2026-10-20",
    coverageGaps: [],
    batches: [{
      id: 93,
      agency: "Pag-IBIG",
      applicableMonth: "2026-09",
      dueDate: "2026-10-19",
      status: "reconciled",
      pendingPostingCount: 0,
      exceptionCount: 0,
      hasActivePaymentProof: true,
    }],
  });
  assert.deepEqual(alerts, []);
});

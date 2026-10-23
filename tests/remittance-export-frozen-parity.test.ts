import assert from "node:assert/strict";
import test from "node:test";
import { buildStatutoryRemittanceSnapshot } from "../src/lib/statutory-remittance";
import {
  assertMonthlyFilingMatchesRemittance,
} from "../src/lib/filing-remittance-snapshot";

test("the UI's frozen remittance liability is the exact per-member total accepted for export", () => {
  const displayedSnapshot = buildStatutoryRemittanceSnapshot({
    agency: "PhilHealth", applicableMonth: "2026-09",
    employees: [
      { id: 101, employeeNo: "FIC-101" },
      { id: 102, employeeNo: "FIC-102" },
    ],
    entries: [
      { employeeId: 101, lineItems: [{ code: "PHIC", amount: -1000 }],
        trace: { inputs: ["philHealthEmployerCutoff=1000.00"] } },
      { employeeId: 102, lineItems: [{ code: "PHIC", amount: -400 }],
        trace: { inputs: ["philHealthEmployerCutoff=400.00"] } },
    ],
  });
  const frozen = {
    agency: "PhilHealth", form: "RF-1", applicableMonth: "2026-09",
    displayed: {
      employeeCount: displayedSnapshot.employeeCount,
      expectedTotal: displayedSnapshot.expectedTotal.toFixed(2),
    },
    members: displayedSnapshot.members.map((member) => ({
      employeeId: member.employeeId,
      totalContribution: member.totalContribution.toFixed(2),
    })),
    exportedEmployeeIds: [101, 102],
  };
  const body = [
    "# DRAFT ONLY - no agency submission",
    "PIN,Employee,TotalPremium",
    "FICTIONAL101,WorkerA,2000.00",
    "FICTIONAL102,WorkerB,800.00",
  ].join("\n");

  const accepted = assertMonthlyFilingMatchesRemittance({ ...frozen, body });
  assert.equal(accepted.reportedTotal.toFixed(2), frozen.displayed.expectedTotal);
  assert.equal(accepted.employeeCount, frozen.displayed.employeeCount);

  // Simulate an entry recalculated after the UI read. A one-cent difference
  // must fail (the generic filing alert comparison permits a cent).
  assert.throws(() => assertMonthlyFilingMatchesRemittance({
    ...frozen, body: body.replace("800.00", "800.01"),
  }), /REMITTANCE_EXPORT_SNAPSHOT_MISMATCH/);
  // Even when totals compensate perfectly, changed employee allocations fail.
  assert.throws(() => assertMonthlyFilingMatchesRemittance({
    ...frozen,
    body: body.replace("2000.00", "1999.99").replace("800.00", "800.01"),
  }), /REMITTANCE_EXPORT_SNAPSHOT_MISMATCH/);
  // A mid-batch omission is not a valid export of this persisted population.
  assert.throws(() => assertMonthlyFilingMatchesRemittance({
    ...frozen, body: body.split("\n").slice(0, -1).join("\n"),
  }), /REMITTANCE_EXPORT_SNAPSHOT_MISMATCH|no employee rows/);
  assert.throws(() => assertMonthlyFilingMatchesRemittance({
    ...frozen, displayed: { ...frozen.displayed, expectedTotal: "2800.01" }, body,
  }), /REMITTANCE_EXPORT_SNAPSHOT_MISMATCH/);
});

test("SSS and Pag-IBIG worksheet bytes also obey the persisted per-employee amounts", () => {
  for (const [agency, form, totalColumn] of [
    ["SSS", "R-3", "Total_Contribution"],
    ["Pag-IBIG", "MCRF", "TotalContribution"],
  ] as const) {
    const input = {
      agency, form, applicableMonth: "2026-09",
      displayed: { employeeCount: 2, expectedTotal: "300.00" },
      members: [
        { employeeId: 2, totalContribution: "200.00" },
        { employeeId: 1, totalContribution: "100.00" },
      ],
      exportedEmployeeIds: [1, 2],
      body: [
        "# DRAFT ONLY",
        "Reference," + totalColumn,
        "FICTIONAL1,100.00",
        "FICTIONAL2,200.00",
      ].join("\n"),
    };
    assert.equal(assertMonthlyFilingMatchesRemittance(input).reportedTotal, 300);
    assert.throws(() => assertMonthlyFilingMatchesRemittance({
      ...input, exportedEmployeeIds: [2, 1],
    }), /REMITTANCE_EXPORT_SNAPSHOT_MISMATCH/);
  }
});

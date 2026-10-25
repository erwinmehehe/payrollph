// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET billing": 2,
  "GET payroll-overpayment-preview": 7,
  "GET payroll/overpayment-preflight": 8,
  "GET billing/subscription": 19,
  "GET leave": 31,
  "GET earned-wage": 52,
  "GET leave/conversion": 57,
  "GET loans": 58
};

export function createRows({ db, earnedWageRequests, employeeLoans, invoices, leaveConversions, leaveRequests, proofs }) {
  return [
  { key: "GET billing", flags: ["XENDIT_BILLING_ENABLED"],
    prove: proofs.all(proofs.echoesOrganization("organization.id"), proofs.valueHasOwnMarker("organization.legalName")) },
  { key: "GET payroll-overpayment-preview", flags: ["HCM_OVERPAYMENT_PREVIEW_ENABLED"],
    prove: proofs.listsOwnMarker("employees", "employeeNo") },
  { key: "GET payroll/overpayment-preflight", flags: ["PAYROLL_OVERPAYMENT_REVIEW_ENABLED"],
    prove: proofs.listsOwnMarker("employees", "employeeNo") },
  { key: "GET billing/subscription",
    seed: (e) => db.insert(invoices).values({ organizationId: e.org.id, number: e.marker, amountCents: 100 * e.rank }),
    prove: proofs.listsOwnMarker("invoices", "number") },
  { key: "GET leave",
    seed: (e) => db.insert(leaveRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, leaveType: "vacation",
      startDate: "2026-03-02", endDate: "2026-03-02", days: "1.0" }),
    prove: proofs.listsOwnMarker("requests", "employeeName") },
  { key: "GET earned-wage", query: (c) => "employeeId=" + c.workerId,
    seed: (e) => db.insert(earnedWageRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, requestedAmount: "100.00" }),
    prove: proofs.all(proofs.listsOwnRow("requests", "employeeId", "workerId"), proofs.echoesOwn("eligibility.employeeId", "workerId")) },
  { key: "GET leave/conversion",
    seed: (e) => db.insert(leaveConversions).values({ organizationId: e.org.id, employeeId: e.worker.id, leaveType: "vacation",
      daysConverted: "1.0", dailyRate: "900.00", cashAmount: "900.00" }),
    prove: proofs.listsOwnRow("conversions", "employeeId", "workerId") },
  { key: "GET loans",
    seed: (e) => db.insert(employeeLoans).values({ organizationId: e.org.id, employeeId: e.worker.id, loanType: "Fictional loan", referenceNo: e.marker,
      principal: "10000.00", monthlyAmortization: "1000.00", cutoffDeduction: "500.00", remainingBalance: "9000.00" }),
    prove: proofs.listsOwnMarker("loans", "referenceNo") },
  ];
}

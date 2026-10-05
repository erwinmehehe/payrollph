import assert from "node:assert/strict";
import test from "node:test";
import { auditStatutoryContributionMonth } from "../src/lib/statutory-contribution-assurance";

const employee = [{
  id: 1,
  employeeNo: "EMP-001",
  sssNo: "34-1234567-8",
  philHealthNo: "12-123456789-1",
  pagIbigNo: "1234-5678-9012",
}];

function trace(inputs: string[]) {
  return { inputs };
}

test("SSS assurance accepts a correctly completed monthly contribution", () => {
  const result = auditStatutoryContributionMonth({
    agency: "SSS",
    employees: employee,
    entries: [{
      employeeId: 1,
      grossPay: "15000.00",
      lineItems: [{ code: "SSS", amount: -750 }],
      trace: trace([
        "supplementaryExcludedFromSssBase=0.00",
        "sssEmployerCutoff=1500.00",
        "sssEmployerEcCutoff=30.00",
      ]),
    }],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("SSS assurance catches missing EC after an employee leaves before the final cutoff", () => {
  const result = auditStatutoryContributionMonth({
    agency: "SSS",
    employees: employee,
    entries: [{
      employeeId: 1,
      grossPay: "15000.00",
      lineItems: [{ code: "SSS", amount: -750 }],
      trace: trace([
        "supplementaryExcludedFromSssBase=0.00",
        "sssEmployerCutoff=1500.00",
        "sssEmployerEcCutoff=15.00",
      ]),
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].component, "employer");
  assert.equal(result.issues[0].expected, 1530);
  assert.equal(result.issues[0].actual, 1515);
});

test("SSS assurance aggregates both cutoffs before recomputing the monthly obligation", () => {
  const result = auditStatutoryContributionMonth({
    agency: "SSS",
    employees: employee,
    entries: [
      {
        employeeId: 1,
        grossPay: "15000.00",
        lineItems: [{ code: "SSS", amount: -750 }],
        trace: trace([
          "supplementaryExcludedFromSssBase=0.00",
          "sssEmployerCutoff=1500.00",
          "sssEmployerEcCutoff=15.00",
        ]),
      },
      {
        employeeId: 1,
        grossPay: "15000.00",
        lineItems: [{ code: "SSS", amount: -750 }],
        trace: trace([
          "supplementaryExcludedFromSssBase=0.00",
          "sssEmployerCutoff=1500.00",
          "sssEmployerEcCutoff=15.00",
        ]),
      },
    ],
  });

  assert.equal(result.ok, true);
});

test("PhilHealth assurance catches a half-collected monthly premium", () => {
  const result = auditStatutoryContributionMonth({
    agency: "PhilHealth",
    employees: employee,
    entries: [{
      employeeId: 1,
      grossPay: "15000.00",
      lineItems: [{ code: "PHIC", amount: -375 }],
      trace: trace([
        "philHealthContributionBase=30000.00",
        "philHealthEmployerCutoff=375.00",
      ]),
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 2);
  assert.deepEqual(
    result.issues.map((issue) => [issue.component, issue.expected, issue.actual]),
    [["employee", 750, 375], ["employer", 750, 375]],
  );
});

test("Pag-IBIG assurance catches a half-collected mandatory contribution", () => {
  const result = auditStatutoryContributionMonth({
    agency: "Pag-IBIG",
    employees: employee,
    entries: [{
      employeeId: 1,
      grossPay: "15000.00",
      lineItems: [{ code: "HDMF", amount: -100 }],
      trace: trace([
        "supplementaryExcludedFromPagIbigBase=0.00",
        "pagIbigEmployerCutoff=100.00",
      ]),
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 2);
  assert.deepEqual(
    result.issues.map((issue) => [issue.component, issue.expected, issue.actual]),
    [["employee", 200, 100], ["employer", 200, 100]],
  );
});

test("Pag-IBIG voluntary savings do not create a false mandatory variance", () => {
  const result = auditStatutoryContributionMonth({
    agency: "Pag-IBIG",
    employees: employee,
    entries: [{
      employeeId: 1,
      grossPay: "15000.00",
      lineItems: [
        { code: "HDMF", amount: -200 },
        { code: "HDMF_VOL", amount: -500 },
      ],
      trace: trace([
        "supplementaryExcludedFromPagIbigBase=0.00",
        "pagIbigEmployerCutoff=200.00",
      ]),
    }],
  });

  assert.equal(result.ok, true);
});

test("SSS assurance excludes expense reimbursement and explicitly excluded earnings from remuneration", () => {
  const result = auditStatutoryContributionMonth({
    agency: "SSS",
    employees: employee,
    entries: [{
      employeeId: 1,
      grossPay: "17000.00",
      lineItems: [
        { code: "EXP-7", amount: 1000 },
        { code: "SSS", amount: -750 },
      ],
      trace: trace([
        "supplementaryExcludedFromSssBase=1000.00",
        "sssEmployerCutoff=1500.00",
        "sssEmployerEcCutoff=30.00",
      ]),
    }],
  });

  assert.equal(result.ok, true);
});


test("assurance blocks missing agency membership numbers without exposing another identifier", () => {
  const result = auditStatutoryContributionMonth({
    agency: "SSS",
    employees: [{
      id: 1,
      employeeNo: "EMP-001",
      sssNo: null,
      philHealthNo: "12-123456789-1",
      pagIbigNo: "1234-5678-9012",
    }],
    entries: [{
      employeeId: 1,
      grossPay: "15000.00",
      lineItems: [{ code: "SSS", amount: -750 }],
      trace: trace([
        "supplementaryExcludedFromSssBase=0.00",
        "sssEmployerCutoff=1500.00",
        "sssEmployerEcCutoff=30.00",
      ]),
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues[0].component, "identity");
  assert.match(result.issues[0].message, /missing the SSS membership number/i);
  assert.ok(!result.issues[0].message.includes("12-123456789-1"));
});

test("assurance rejects malformed member numbers by agency digit count", () => {
  const result = auditStatutoryContributionMonth({
    agency: "Pag-IBIG",
    employees: [{
      id: 1,
      employeeNo: "EMP-001",
      sssNo: "34-1234567-8",
      philHealthNo: "12-123456789-1",
      pagIbigNo: "12345",
    }],
    entries: [{
      employeeId: 1,
      grossPay: "15000.00",
      lineItems: [{ code: "HDMF", amount: -200 }],
      trace: trace([
        "supplementaryExcludedFromPagIbigBase=0.00",
        "pagIbigEmployerCutoff=200.00",
      ]),
    }],
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.component === "identity"));
  assert.match(result.issues.find((issue) => issue.component === "identity")!.message, /invalid digit count/i);
});

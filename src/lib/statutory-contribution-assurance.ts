import { computePagIbig, computePhilHealth, computeSss } from "@/lib/payroll-rules";
import type { StatutoryAgency } from "@/lib/statutory-remittance";

type Entry = {
  employeeId: number;
  grossPay: string | number;
  lineItems: unknown;
  trace: unknown;
};

type EmployeeIdentity = {
  id: number;
  employeeNo: string;
};

export type StatutoryContributionVariance = {
  employeeId: number;
  employeeNo: string;
  agency: StatutoryAgency;
  component: "employee" | "employer" | "basis";
  expected: number | null;
  actual: number | null;
  difference: number | null;
  message: string;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function traceInputNumber(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return 0;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return 0;
  const prefix = `${key}=`;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  return typeof raw === "string" ? Number(raw.slice(prefix.length)) || 0 : 0;
}

function deduction(lineItems: unknown, code: string) {
  if (!Array.isArray(lineItems)) return 0;
  return round2(lineItems
    .filter((item) =>
      item
      && typeof item === "object"
      && String((item as { code?: unknown }).code ?? "").toUpperCase() === code,
    )
    .reduce((sum, item) =>
      sum + Math.abs(Number((item as { amount?: unknown }).amount ?? 0) || 0),
    0));
}

function expenseReimbursements(lineItems: unknown) {
  if (!Array.isArray(lineItems)) return 0;
  return round2(lineItems
    .filter((item) =>
      item
      && typeof item === "object"
      && String((item as { code?: unknown }).code ?? "").startsWith("EXP-"),
    )
    .reduce((sum, item) =>
      sum + Math.max(0, Number((item as { amount?: unknown }).amount ?? 0) || 0),
    0));
}

function addVariance(
  issues: StatutoryContributionVariance[],
  input: {
    employeeId: number;
    employeeNo: string;
    agency: StatutoryAgency;
    component: "employee" | "employer";
    expected: number;
    actual: number;
  },
) {
  const expected = round2(input.expected);
  const actual = round2(input.actual);
  const difference = round2(actual - expected);
  if (Math.abs(difference) <= 0.01) return;

  issues.push({
    ...input,
    expected,
    actual,
    difference,
    message:
      `${input.employeeNo} ${input.agency} ${input.component} share is `
      + `${difference < 0 ? "under" : "over"} by PHP ${Math.abs(difference).toFixed(2)} `
      + `(expected ${expected.toFixed(2)}, payroll has ${actual.toFixed(2)}).`,
  });
}

export function auditStatutoryContributionMonth(input: {
  agency: StatutoryAgency;
  entries: Entry[];
  employees: EmployeeIdentity[];
}) {
  const employeeById = new Map(input.employees.map((employee) => [employee.id, employee]));
  const aggregates = new Map<number, {
    grossPay: number;
    sssBase: number;
    pagIbigBase: number;
    philHealthBase: number;
    employeeShare: number;
    employerShare: number;
  }>();

  for (const entry of input.entries) {
    const current = aggregates.get(entry.employeeId) ?? {
      grossPay: 0,
      sssBase: 0,
      pagIbigBase: 0,
      philHealthBase: 0,
      employeeShare: 0,
      employerShare: 0,
    };
    const grossPay = Math.max(0, Number(entry.grossPay) || 0);
    const expenses = expenseReimbursements(entry.lineItems);
    const excludedSss = traceInputNumber(entry.trace, "supplementaryExcludedFromSssBase");
    const excludedPagIbig = traceInputNumber(entry.trace, "supplementaryExcludedFromPagIbigBase");

    current.grossPay = round2(current.grossPay + grossPay);
    current.sssBase = round2(
      current.sssBase + Math.max(0, grossPay - expenses - excludedSss),
    );
    current.pagIbigBase = round2(
      current.pagIbigBase + Math.max(0, grossPay - expenses - excludedPagIbig),
    );
    current.philHealthBase = Math.max(
      current.philHealthBase,
      traceInputNumber(entry.trace, "philHealthContributionBase"),
    );

    if (input.agency === "SSS") {
      current.employeeShare = round2(current.employeeShare + deduction(entry.lineItems, "SSS"));
      current.employerShare = round2(
        current.employerShare
        + traceInputNumber(entry.trace, "sssEmployerCutoff")
        + traceInputNumber(entry.trace, "sssEmployerEcCutoff"),
      );
    } else if (input.agency === "PhilHealth") {
      current.employeeShare = round2(current.employeeShare + deduction(entry.lineItems, "PHIC"));
      current.employerShare = round2(
        current.employerShare + traceInputNumber(entry.trace, "philHealthEmployerCutoff"),
      );
    } else {
      // Voluntary HDMF savings are intentionally excluded from this assurance
      // check. They are remitted when actually deducted, but they are not part
      // of the mandatory employee share being independently recomputed here.
      current.employeeShare = round2(current.employeeShare + deduction(entry.lineItems, "HDMF"));
      current.employerShare = round2(
        current.employerShare + traceInputNumber(entry.trace, "pagIbigEmployerCutoff"),
      );
    }

    aggregates.set(entry.employeeId, current);
  }

  const issues: StatutoryContributionVariance[] = [];

  for (const [employeeId, aggregate] of aggregates) {
    const employee = employeeById.get(employeeId);
    if (!employee) {
      issues.push({
        employeeId,
        employeeNo: `#${employeeId}`,
        agency: input.agency,
        component: "basis",
        expected: null,
        actual: null,
        difference: null,
        message: `Employee #${employeeId} is missing from statutory assurance identity data.`,
      });
      continue;
    }

    if (input.agency === "SSS") {
      if (aggregate.sssBase <= 0 && aggregate.grossPay > 0) {
        issues.push({
          employeeId,
          employeeNo: employee.employeeNo,
          agency: input.agency,
          component: "basis",
          expected: null,
          actual: null,
          difference: null,
          message: `${employee.employeeNo} has payroll earnings but no positive SSS remuneration basis.`,
        });
        continue;
      }
      if (aggregate.sssBase <= 0) continue;
      const rule = computeSss(aggregate.sssBase);
      addVariance(issues, {
        employeeId,
        employeeNo: employee.employeeNo,
        agency: input.agency,
        component: "employee",
        expected: rule.employee,
        actual: aggregate.employeeShare,
      });
      addVariance(issues, {
        employeeId,
        employeeNo: employee.employeeNo,
        agency: input.agency,
        component: "employer",
        expected: rule.employerTotal,
        actual: aggregate.employerShare,
      });
      continue;
    }

    if (input.agency === "PhilHealth") {
      if (aggregate.philHealthBase <= 0 && aggregate.grossPay > 0) {
        issues.push({
          employeeId,
          employeeNo: employee.employeeNo,
          agency: input.agency,
          component: "basis",
          expected: null,
          actual: null,
          difference: null,
          message: `${employee.employeeNo} has payroll earnings but no PhilHealth contribution base in payroll trace.`,
        });
        continue;
      }
      if (aggregate.philHealthBase <= 0) continue;
      const rule = computePhilHealth(aggregate.philHealthBase);
      addVariance(issues, {
        employeeId,
        employeeNo: employee.employeeNo,
        agency: input.agency,
        component: "employee",
        expected: rule.employee,
        actual: aggregate.employeeShare,
      });
      addVariance(issues, {
        employeeId,
        employeeNo: employee.employeeNo,
        agency: input.agency,
        component: "employer",
        expected: rule.employer,
        actual: aggregate.employerShare,
      });
      continue;
    }

    if (aggregate.pagIbigBase <= 0 && aggregate.grossPay > 0) {
      issues.push({
        employeeId,
        employeeNo: employee.employeeNo,
        agency: input.agency,
        component: "basis",
        expected: null,
        actual: null,
        difference: null,
        message: `${employee.employeeNo} has payroll earnings but no positive Pag-IBIG compensation basis.`,
      });
      continue;
    }
    if (aggregate.pagIbigBase <= 0) continue;
    const rule = computePagIbig(aggregate.pagIbigBase);
    addVariance(issues, {
      employeeId,
      employeeNo: employee.employeeNo,
      agency: input.agency,
      component: "employee",
      expected: rule.employee,
      actual: aggregate.employeeShare,
    });
    addVariance(issues, {
      employeeId,
      employeeNo: employee.employeeNo,
      agency: input.agency,
      component: "employer",
      expected: rule.employer,
      actual: aggregate.employerShare,
    });
  }

  return {
    ok: issues.length === 0,
    checkedEmployees: aggregates.size,
    issues,
  };
}

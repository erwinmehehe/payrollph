import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  computeCutoffStatutoryDeduction,
  computePagIbig,
  computePhilHealth,
  computeSemiMonthlyWithholdingTax,
  computeSss,
  holidayMultiplier,
  type StatutoryDeductionTiming,
} from "../src/lib/payroll-rules";

type SourceKey = "sss-2025" | "philhealth-2025" | "pagibig-2024" | "bir-2023" | "labor-premiums";

type GoldenScenario = {
  id: string;
  family: "sss" | "philhealth" | "pagibig" | "withholding" | "deduction-timing" | "holiday-multiplier";
  sourceKey: SourceKey;
  description: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown> | number;
};

const sources: Record<SourceKey, {
  agency: string;
  document: string;
  effectiveFrom: string;
  reference: string;
}> = {
  "sss-2025": {
    agency: "Social Security System",
    document: "SSS Circular No. 2024-006 — Schedule of SSS Contributions for Business Employers and Employees",
    effectiveFrom: "2025-01-01",
    reference: "https://www.sss.gov.ph/wp-content/uploads/2024/12/2025-SSS-Contribution-Table-rev.pdf",
  },
  "philhealth-2025": {
    agency: "Philippine Health Insurance Corporation",
    document: "PhilHealth Advisory No. 2025-0002 — Premium Contribution for All Direct Contributors for CY 2025",
    effectiveFrom: "2025-01-01",
    reference: "https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf",
  },
  "pagibig-2024": {
    agency: "Home Development Mutual Fund (Pag-IBIG Fund)",
    document: "Pag-IBIG Fund Circular No. 460 — Increase in Maximum Fund Salary",
    effectiveFrom: "2024-02-01",
    reference: "https://pco.gov.ph/other_releases/pag-ibig-members-to-gain-more-benefits-under-new-rates-starting-february-2024/",
  },
  "bir-2023": {
    agency: "Bureau of Internal Revenue",
    document: "RR No. 11-2018 Annex E — Withholding Tax Table effective January 1, 2023 onwards",
    effectiveFrom: "2023-01-01",
    reference: "https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf",
  },
  "labor-premiums": {
    agency: "Department of Labor and Employment / Philippine labor rules",
    document: "Statutory holiday, rest-day and overtime premium factors encoded in PayrollPH",
    effectiveFrom: "2026-01-01",
    reference: "https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf",
  },
};

const goldenScenarios: GoldenScenario[] = [
  // SSS / MPF boundaries from the employed-member contribution schedule.
  { id: "SSS-001", family: "sss", sourceKey: "sss-2025", description: "Below minimum MSC floors at 5,000", input: { monthlySalary: 0 }, expected: { monthlySalaryCredit: 5000, regularMsc: 5000, mpfMsc: 0, employee: 250, employer: 500, employerEC: 10, total: 760, employerTotal: 510 } },
  { id: "SSS-002", family: "sss", sourceKey: "sss-2025", description: "Just below first midpoint remains 5,000 MSC", input: { monthlySalary: 5249.99 }, expected: { monthlySalaryCredit: 5000, regularMsc: 5000, mpfMsc: 0, employee: 250, employer: 500, employerEC: 10, total: 760, employerTotal: 510 } },
  { id: "SSS-003", family: "sss", sourceKey: "sss-2025", description: "First midpoint moves to 5,500 MSC", input: { monthlySalary: 5250 }, expected: { monthlySalaryCredit: 5500, regularMsc: 5500, mpfMsc: 0, employee: 275, employer: 550, employerEC: 10, total: 835, employerTotal: 560 } },
  { id: "SSS-004", family: "sss", sourceKey: "sss-2025", description: "Upper edge of 5,500 bracket", input: { monthlySalary: 5749.99 }, expected: { monthlySalaryCredit: 5500, regularMsc: 5500, mpfMsc: 0, employee: 275, employer: 550, employerEC: 10, total: 835, employerTotal: 560 } },
  { id: "SSS-005", family: "sss", sourceKey: "sss-2025", description: "Next midpoint moves to 6,000 MSC", input: { monthlySalary: 5750 }, expected: { monthlySalaryCredit: 6000, regularMsc: 6000, mpfMsc: 0, employee: 300, employer: 600, employerEC: 10, total: 910, employerTotal: 610 } },
  { id: "SSS-006", family: "sss", sourceKey: "sss-2025", description: "EC remains 10 below 15,000 MSC", input: { monthlySalary: 14749.99 }, expected: { monthlySalaryCredit: 14500, regularMsc: 14500, mpfMsc: 0, employee: 725, employer: 1450, employerEC: 10, total: 2185, employerTotal: 1460 } },
  { id: "SSS-007", family: "sss", sourceKey: "sss-2025", description: "EC rises to 30 at 15,000 MSC", input: { monthlySalary: 14750 }, expected: { monthlySalaryCredit: 15000, regularMsc: 15000, mpfMsc: 0, employee: 750, employer: 1500, employerEC: 30, total: 2280, employerTotal: 1530 } },
  { id: "SSS-008", family: "sss", sourceKey: "sss-2025", description: "Last bracket below regular SS ceiling", input: { monthlySalary: 19749.99 }, expected: { monthlySalaryCredit: 19500, regularMsc: 19500, mpfMsc: 0, employee: 975, employer: 1950, employerEC: 30, total: 2955, employerTotal: 1980 } },
  { id: "SSS-009", family: "sss", sourceKey: "sss-2025", description: "Regular SS ceiling at 20,000 MSC", input: { monthlySalary: 19750 }, expected: { monthlySalaryCredit: 20000, regularMsc: 20000, mpfMsc: 0, employee: 1000, employer: 2000, employerEC: 30, total: 3030, employerTotal: 2030 } },
  { id: "SSS-010", family: "sss", sourceKey: "sss-2025", description: "Below first MPF midpoint remains regular-only", input: { monthlySalary: 20249.99 }, expected: { monthlySalaryCredit: 20000, regularMsc: 20000, mpfMsc: 0, employee: 1000, employer: 2000, employerEC: 30, total: 3030, employerTotal: 2030 } },
  { id: "SSS-011", family: "sss", sourceKey: "sss-2025", description: "MPF starts above 20,000 MSC", input: { monthlySalary: 20250 }, expected: { monthlySalaryCredit: 20500, regularMsc: 20000, mpfMsc: 500, employee: 1025, employer: 2050, employerEC: 30, total: 3105, employerTotal: 2080 } },
  { id: "SSS-012", family: "sss", sourceKey: "sss-2025", description: "Upper high-income bracket before maximum", input: { monthlySalary: 34749.99 }, expected: { monthlySalaryCredit: 34500, regularMsc: 20000, mpfMsc: 14500, employee: 1725, employer: 3450, employerEC: 30, total: 5205, employerTotal: 3480 } },
  { id: "SSS-013", family: "sss", sourceKey: "sss-2025", description: "Maximum MSC begins at final midpoint", input: { monthlySalary: 34750 }, expected: { monthlySalaryCredit: 35000, regularMsc: 20000, mpfMsc: 15000, employee: 1750, employer: 3500, employerEC: 30, total: 5280, employerTotal: 3530 } },
  { id: "SSS-014", family: "sss", sourceKey: "sss-2025", description: "Compensation above ceiling remains capped", input: { monthlySalary: 40000 }, expected: { monthlySalaryCredit: 35000, regularMsc: 20000, mpfMsc: 15000, employee: 1750, employer: 3500, employerEC: 30, total: 5280, employerTotal: 3530 } },

  // PhilHealth 5% floor/ceiling and centavo allocation.
  { id: "PHIC-001", family: "philhealth", sourceKey: "philhealth-2025", description: "Zero salary still uses 10,000 statutory floor", input: { monthlySalary: 0 }, expected: { base: 10000, total: 500, employee: 250, employer: 250 } },
  { id: "PHIC-002", family: "philhealth", sourceKey: "philhealth-2025", description: "Below floor uses 10,000 base", input: { monthlySalary: 9999.99 }, expected: { base: 10000, total: 500, employee: 250, employer: 250 } },
  { id: "PHIC-003", family: "philhealth", sourceKey: "philhealth-2025", description: "Exact floor", input: { monthlySalary: 10000 }, expected: { base: 10000, total: 500, employee: 250, employer: 250 } },
  { id: "PHIC-004", family: "philhealth", sourceKey: "philhealth-2025", description: "Odd-centavo premium assigns remainder to employer", input: { monthlySalary: 10000.2 }, expected: { base: 10000.2, total: 500.01, employee: 250, employer: 250.01 } },
  { id: "PHIC-005", family: "philhealth", sourceKey: "philhealth-2025", description: "Even-centavo rounded premium splits evenly", input: { monthlySalary: 10000.3 }, expected: { base: 10000.3, total: 500.02, employee: 250.01, employer: 250.01 } },
  { id: "PHIC-006", family: "philhealth", sourceKey: "philhealth-2025", description: "Non-round salary calculation", input: { monthlySalary: 12345.67 }, expected: { base: 12345.67, total: 617.28, employee: 308.64, employer: 308.64 } },
  { id: "PHIC-007", family: "philhealth", sourceKey: "philhealth-2025", description: "Mid-range salary", input: { monthlySalary: 50000 }, expected: { base: 50000, total: 2500, employee: 1250, employer: 1250 } },
  { id: "PHIC-008", family: "philhealth", sourceKey: "philhealth-2025", description: "Just below ceiling rounds to maximum premium", input: { monthlySalary: 99999.99 }, expected: { base: 99999.99, total: 5000, employee: 2500, employer: 2500 } },
  { id: "PHIC-009", family: "philhealth", sourceKey: "philhealth-2025", description: "Exact 100,000 ceiling", input: { monthlySalary: 100000 }, expected: { base: 100000, total: 5000, employee: 2500, employer: 2500 } },
  { id: "PHIC-010", family: "philhealth", sourceKey: "philhealth-2025", description: "Salary above ceiling remains capped", input: { monthlySalary: 120000 }, expected: { base: 100000, total: 5000, employee: 2500, employer: 2500 } },

  // Pag-IBIG contribution rate and 10,000 maximum fund salary.
  { id: "HDMF-001", family: "pagibig", sourceKey: "pagibig-2024", description: "Zero compensation", input: { monthlySalary: 0 }, expected: { fundSalary: 0, employeeRate: 0.01, employerRate: 0.02, employee: 0, employer: 0, total: 0 } },
  { id: "HDMF-002", family: "pagibig", sourceKey: "pagibig-2024", description: "1% employee rate below 1,500", input: { monthlySalary: 1000 }, expected: { fundSalary: 1000, employeeRate: 0.01, employerRate: 0.02, employee: 10, employer: 20, total: 30 } },
  { id: "HDMF-003", family: "pagibig", sourceKey: "pagibig-2024", description: "Just below rate breakpoint", input: { monthlySalary: 1499.99 }, expected: { fundSalary: 1499.99, employeeRate: 0.01, employerRate: 0.02, employee: 15, employer: 30, total: 45 } },
  { id: "HDMF-004", family: "pagibig", sourceKey: "pagibig-2024", description: "Exact 1,500 breakpoint stays at 1%", input: { monthlySalary: 1500 }, expected: { fundSalary: 1500, employeeRate: 0.01, employerRate: 0.02, employee: 15, employer: 30, total: 45 } },
  { id: "HDMF-005", family: "pagibig", sourceKey: "pagibig-2024", description: "Above 1,500 uses 2% employee rate", input: { monthlySalary: 1500.01 }, expected: { fundSalary: 1500.01, employeeRate: 0.02, employerRate: 0.02, employee: 30, employer: 30, total: 60 } },
  { id: "HDMF-006", family: "pagibig", sourceKey: "pagibig-2024", description: "5,000 fund salary at 2% each", input: { monthlySalary: 5000 }, expected: { fundSalary: 5000, employeeRate: 0.02, employerRate: 0.02, employee: 100, employer: 100, total: 200 } },
  { id: "HDMF-007", family: "pagibig", sourceKey: "pagibig-2024", description: "Just below maximum fund salary", input: { monthlySalary: 9999.99 }, expected: { fundSalary: 9999.99, employeeRate: 0.02, employerRate: 0.02, employee: 200, employer: 200, total: 400 } },
  { id: "HDMF-008", family: "pagibig", sourceKey: "pagibig-2024", description: "Exact 10,000 maximum fund salary", input: { monthlySalary: 10000 }, expected: { fundSalary: 10000, employeeRate: 0.02, employerRate: 0.02, employee: 200, employer: 200, total: 400 } },
  { id: "HDMF-009", family: "pagibig", sourceKey: "pagibig-2024", description: "Immediately above maximum remains capped", input: { monthlySalary: 10000.01 }, expected: { fundSalary: 10000, employeeRate: 0.02, employerRate: 0.02, employee: 200, employer: 200, total: 400 } },
  { id: "HDMF-010", family: "pagibig", sourceKey: "pagibig-2024", description: "Higher salary remains capped", input: { monthlySalary: 25000 }, expected: { fundSalary: 10000, employeeRate: 0.02, employerRate: 0.02, employee: 200, employer: 200, total: 400 } },

  // BIR semi-monthly withholding thresholds effective 2023 onwards.
  { id: "BIR-001", family: "withholding", sourceKey: "bir-2023", description: "Zero taxable compensation", input: { taxableIncome: 0, isMwe: false }, expected: 0 },
  { id: "BIR-002", family: "withholding", sourceKey: "bir-2023", description: "Just below zero-tax ceiling", input: { taxableIncome: 10416.99, isMwe: false }, expected: 0 },
  { id: "BIR-003", family: "withholding", sourceKey: "bir-2023", description: "Exact zero-tax ceiling", input: { taxableIncome: 10417, isMwe: false }, expected: 0 },
  { id: "BIR-004", family: "withholding", sourceKey: "bir-2023", description: "First taxable bracket", input: { taxableIncome: 11000, isMwe: false }, expected: 87.45 },
  { id: "BIR-005", family: "withholding", sourceKey: "bir-2023", description: "Top of first taxable bracket", input: { taxableIncome: 16667, isMwe: false }, expected: 937.5 },
  { id: "BIR-006", family: "withholding", sourceKey: "bir-2023", description: "Just into second taxable bracket", input: { taxableIncome: 16667.01, isMwe: false }, expected: 937.5 },
  { id: "BIR-007", family: "withholding", sourceKey: "bir-2023", description: "Second bracket interior", input: { taxableIncome: 20000, isMwe: false }, expected: 1604.1 },
  { id: "BIR-008", family: "withholding", sourceKey: "bir-2023", description: "Top of second bracket", input: { taxableIncome: 33333, isMwe: false }, expected: 4270.7 },
  { id: "BIR-009", family: "withholding", sourceKey: "bir-2023", description: "Start of 25% bracket", input: { taxableIncome: 33334, isMwe: false }, expected: 4270.95 },
  { id: "BIR-010", family: "withholding", sourceKey: "bir-2023", description: "25% bracket interior", input: { taxableIncome: 50000, isMwe: false }, expected: 8437.45 },
  { id: "BIR-011", family: "withholding", sourceKey: "bir-2023", description: "Top of 25% bracket", input: { taxableIncome: 83333, isMwe: false }, expected: 16770.7 },
  { id: "BIR-012", family: "withholding", sourceKey: "bir-2023", description: "Start of 30% bracket", input: { taxableIncome: 83334, isMwe: false }, expected: 16771 },
  { id: "BIR-013", family: "withholding", sourceKey: "bir-2023", description: "30% bracket interior", input: { taxableIncome: 100000, isMwe: false }, expected: 21770.8 },
  { id: "BIR-014", family: "withholding", sourceKey: "bir-2023", description: "Top of 30% bracket", input: { taxableIncome: 333333, isMwe: false }, expected: 91770.7 },
  { id: "BIR-015", family: "withholding", sourceKey: "bir-2023", description: "Start of 35% bracket", input: { taxableIncome: 333334, isMwe: false }, expected: 91771.05 },
  { id: "BIR-016", family: "withholding", sourceKey: "bir-2023", description: "35% bracket interior", input: { taxableIncome: 500000, isMwe: false }, expected: 150104.15 },
  { id: "BIR-017", family: "withholding", sourceKey: "bir-2023", description: "MWE exemption overrides ordinary table", input: { taxableIncome: 500000, isMwe: true }, expected: 0 },

  // Monthly statutory deduction timing/true-up behavior.
  { id: "CUT-001", family: "deduction-timing", sourceKey: "sss-2025", description: "Split timing takes half on first cutoff", input: { monthlyTarget: 1000, priorCollected: 0, timing: "split", isSecondCutoff: false }, expected: 500 },
  { id: "CUT-002", family: "deduction-timing", sourceKey: "sss-2025", description: "Split timing collects balance on second cutoff", input: { monthlyTarget: 1000, priorCollected: 500, timing: "split", isSecondCutoff: true }, expected: 500 },
  { id: "CUT-003", family: "deduction-timing", sourceKey: "sss-2025", description: "Split second cutoff true-up catches undercollection", input: { monthlyTarget: 1000, priorCollected: 400, timing: "split", isSecondCutoff: true }, expected: 600 },
  { id: "CUT-004", family: "deduction-timing", sourceKey: "sss-2025", description: "Split timing never creates negative deduction", input: { monthlyTarget: 1000, priorCollected: 1200, timing: "split", isSecondCutoff: true }, expected: 0 },
  { id: "CUT-005", family: "deduction-timing", sourceKey: "sss-2025", description: "First-cutoff timing collects target immediately", input: { monthlyTarget: 1000, priorCollected: 0, timing: "first_cutoff", isSecondCutoff: false }, expected: 1000 },
  { id: "CUT-006", family: "deduction-timing", sourceKey: "sss-2025", description: "First-cutoff timing has no duplicate second deduction", input: { monthlyTarget: 1000, priorCollected: 1000, timing: "first_cutoff", isSecondCutoff: true }, expected: 0 },
  { id: "CUT-007", family: "deduction-timing", sourceKey: "sss-2025", description: "First-cutoff timing permits later target true-up", input: { monthlyTarget: 1200, priorCollected: 1000, timing: "first_cutoff", isSecondCutoff: true }, expected: 200 },
  { id: "CUT-008", family: "deduction-timing", sourceKey: "sss-2025", description: "Second-cutoff timing collects nothing on first cutoff", input: { monthlyTarget: 1000, priorCollected: 0, timing: "second_cutoff", isSecondCutoff: false }, expected: 0 },
  { id: "CUT-009", family: "deduction-timing", sourceKey: "sss-2025", description: "Second-cutoff timing collects full target", input: { monthlyTarget: 1000, priorCollected: 0, timing: "second_cutoff", isSecondCutoff: true }, expected: 1000 },
  { id: "CUT-010", family: "deduction-timing", sourceKey: "sss-2025", description: "Second-cutoff timing subtracts prior collection", input: { monthlyTarget: 1000, priorCollected: 400, timing: "second_cutoff", isSecondCutoff: true }, expected: 600 },
  { id: "CUT-011", family: "deduction-timing", sourceKey: "sss-2025", description: "Second-cutoff timing floors overcollection at zero", input: { monthlyTarget: 1000, priorCollected: 1200, timing: "second_cutoff", isSecondCutoff: true }, expected: 0 },
  { id: "CUT-012", family: "deduction-timing", sourceKey: "sss-2025", description: "Split timing rounds half-target to centavos", input: { monthlyTarget: 1000.02, priorCollected: 0, timing: "split", isSecondCutoff: false }, expected: 500.01 },

  // Holiday/rest-day/overtime statutory factor matrix.
  { id: "PREM-001", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Ordinary unworked day", input: { holiday: "ordinary", worked: false }, expected: 0 },
  { id: "PREM-002", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Ordinary worked day", input: { holiday: "ordinary", worked: true }, expected: 1 },
  { id: "PREM-003", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Ordinary rest day worked", input: { holiday: "ordinary", worked: true, restDay: true }, expected: 1.3 },
  { id: "PREM-004", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Ordinary overtime", input: { holiday: "ordinary", worked: true, overtime: true }, expected: 1.25 },
  { id: "PREM-005", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Rest-day overtime", input: { holiday: "ordinary", worked: true, restDay: true, overtime: true }, expected: 1.69 },
  { id: "PREM-006", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Special day unworked", input: { holiday: "special", worked: false }, expected: 0 },
  { id: "PREM-007", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Special day worked", input: { holiday: "special", worked: true }, expected: 1.3 },
  { id: "PREM-008", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Special day plus rest day", input: { holiday: "special", worked: true, restDay: true }, expected: 1.5 },
  { id: "PREM-009", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Special-day overtime", input: { holiday: "special", worked: true, overtime: true }, expected: 1.69 },
  { id: "PREM-010", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Special rest-day overtime", input: { holiday: "special", worked: true, restDay: true, overtime: true }, expected: 1.95 },
  { id: "PREM-011", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Regular holiday unworked", input: { holiday: "regular", worked: false }, expected: 1 },
  { id: "PREM-012", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Regular holiday worked", input: { holiday: "regular", worked: true }, expected: 2 },
  { id: "PREM-013", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Regular holiday on rest day", input: { holiday: "regular", worked: true, restDay: true }, expected: 2.6 },
  { id: "PREM-014", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Regular-holiday overtime", input: { holiday: "regular", worked: true, overtime: true }, expected: 2.6 },
  { id: "PREM-015", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Regular holiday/rest-day overtime", input: { holiday: "regular", worked: true, restDay: true, overtime: true }, expected: 3.38 },
  { id: "PREM-016", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Double holiday unworked", input: { holiday: "double", worked: false }, expected: 2 },
  { id: "PREM-017", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Double holiday worked", input: { holiday: "double", worked: true }, expected: 3 },
  { id: "PREM-018", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Double holiday on rest day", input: { holiday: "double", worked: true, restDay: true }, expected: 3.9 },
  { id: "PREM-019", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Double-holiday overtime", input: { holiday: "double", worked: true, overtime: true }, expected: 3.9 },
  { id: "PREM-020", family: "holiday-multiplier", sourceKey: "labor-premiums", description: "Double holiday/rest-day overtime", input: { holiday: "double", worked: true, restDay: true, overtime: true }, expected: 5.07 },
];

function selectSss(actual: ReturnType<typeof computeSss>) {
  return {
    monthlySalaryCredit: actual.monthlySalaryCredit,
    regularMsc: actual.regularMsc,
    mpfMsc: actual.mpfMsc,
    employee: actual.employee,
    employer: actual.employer,
    employerEC: actual.employerEC,
    total: actual.total,
    employerTotal: actual.employerTotal,
  };
}

function evaluate(scenario: GoldenScenario) {
  if (scenario.family === "sss") {
    return selectSss(computeSss(Number(scenario.input.monthlySalary)));
  }
  if (scenario.family === "philhealth") {
    return computePhilHealth(Number(scenario.input.monthlySalary));
  }
  if (scenario.family === "pagibig") {
    return computePagIbig(Number(scenario.input.monthlySalary));
  }
  if (scenario.family === "withholding") {
    return computeSemiMonthlyWithholdingTax(
      Number(scenario.input.taxableIncome),
      Boolean(scenario.input.isMwe),
    );
  }
  if (scenario.family === "deduction-timing") {
    return computeCutoffStatutoryDeduction({
      monthlyTarget: Number(scenario.input.monthlyTarget),
      priorCollected: Number(scenario.input.priorCollected),
      timing: String(scenario.input.timing) as StatutoryDeductionTiming,
      isSecondCutoff: Boolean(scenario.input.isSecondCutoff),
    });
  }
  return holidayMultiplier({
    holiday: String(scenario.input.holiday) as "ordinary" | "special" | "regular" | "double",
    worked: Boolean(scenario.input.worked),
    restDay: Boolean(scenario.input.restDay),
    overtime: Boolean(scenario.input.overtime),
  });
}

function main() {
  mkdirSync("qa-artifacts", { recursive: true });

  const results = goldenScenarios.map((scenario) => {
    const actual = evaluate(scenario);
    try {
      assert.deepStrictEqual(actual, scenario.expected);
      return { ...scenario, actual, passed: true as const };
    } catch (error) {
      return {
        ...scenario,
        actual,
        passed: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const failed = results.filter((item) => !item.passed);
  const familyCounts = Object.fromEntries(
    [...new Set(goldenScenarios.map((scenario) => scenario.family))].map((family) => [
      family,
      goldenScenarios.filter((scenario) => scenario.family === family).length,
    ]),
  );
  const catalogSha256 = createHash("sha256")
    .update(JSON.stringify(goldenScenarios))
    .digest("hex");

  const report = {
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? "passed" : "failed",
    scenarioCount: goldenScenarios.length,
    passed: results.length - failed.length,
    failed: failed.length,
    familyCounts,
    catalogSha256,
    independence: "Expected outputs are hard-coded from cited statutory source tables and are not generated by the payroll functions under test.",
    limitations: [
      "This Phase 1 catalog validates statutory boundary calculations; it is not yet the full employee-level gross-to-net/GL golden payroll catalog required by issue #192.",
      "Passing CI is not CPA or payroll-practitioner sign-off.",
      "This does not prove real government filing acceptance, real bank portal acceptance, or parallel-run reconciliation against an incumbent payroll system.",
    ],
    sources,
    results,
  };

  writeFileSync(
    "qa-artifacts/golden-payroll-certification.json",
    JSON.stringify(report, null, 2),
  );

  console.log(
    JSON.stringify(
      {
        status: report.status,
        scenarioCount: report.scenarioCount,
        passed: report.passed,
        failed: report.failed,
        familyCounts,
        catalogSha256,
      },
      null,
      2,
    ),
  );

  assert.ok(goldenScenarios.length >= 50, "Golden certification catalog must contain at least 50 independently expected vectors.");
  assert.equal(failed.length, 0, `Golden certification failures: ${failed.map((item) => item.id).join(", ")}`);
}

main();

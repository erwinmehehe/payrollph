/**
 * Separately authored fictional M-10 centavo expectation ledger.
 *
 * These 44 entries are independent mathematical golden examples, NOT statutory
 * contribution rates, independently approved payroll liabilities or agency
 * receipts. Scenario 12 is absent because it lacks verified source evidence.
 */
import type { M10IndependentExpectation } from "../../src/lib/payroll-m10-centavo-evidence";

const DIRECTIONS: ReadonlyArray<readonly [string, -1 | 1]> = [
  ["01", 1],
  ["02", -1],
  ["03", 1],
  ["04", -1],
  ["05", 1],
  ["06", -1],
  ["07", 1],
  ["08", -1],
  ["09", 1],
  ["10", 1],
  ["11", 1],
];

export function createIndependentM10FictionalExpected(): M10IndependentExpectation[] {
  const expected: M10IndependentExpectation[] = [];
  for (const organizationId of [101, 202]) {
    for (const agency of ["SSS", "Pag-IBIG"] as const) {
      for (const [code, direction] of DIRECTIONS) {
        const expectedDifference = agency === "SSS"
          ? {
            agency: "SSS" as const,
            employeeRegularCentavos: direction * 500,
            employeeMpfCentavos: 0,
            employerRegularCentavos: direction * 1000,
            employerMpfCentavos: 0,
            employerEcCentavos: 0,
            totalCentavos: direction * 1500,
          }
          : {
            agency: "Pag-IBIG" as const,
            employeeSavingsCentavos: direction * 500,
            employerSavingsCentavos: direction * 500,
            totalCentavos: direction * 1000,
          };
        expected.push({
          caseId: "fictional-" + organizationId + "-" + agency + "-" + code,
          agency,
          organizationId,
          employeeId: organizationId * 10 + 1,
          adjustmentId: Number(code),
          expectedDifference,
          expectationReference: "FIXTURE-ONLY-LEDGER-" + agency + "-" + code,
        });
      }
    }
  }
  return expected;
}

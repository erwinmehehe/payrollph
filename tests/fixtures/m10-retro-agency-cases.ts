/**
 * Fully fictional M-10 agency review samples for two unrelated employers.
 * Worksheet values deliberately test integer-centavo arithmetic only; they
 * are NOT official SSS or HDMF contribution assessments or agency receipts.
 */
import type { M10Agency, M10ReviewInput, M10WorksheetShares } from "../../src/lib/payroll-m10-readonly-review";

type Scenario = Readonly<{
  code: string;
  name: string;
  sourceStart: string | null;
  sourceEnd: string | null;
  correctionStart: string;
  correctionEnd: string;
  wageDeltaCentavos: number;
  remittance: M10ReviewInput["remittanceState"];
}>;

export const M10_FICTIONAL_SCENARIOS: readonly Scenario[] = [
  { code: "01", name: "same month positive unfiled", sourceStart: "2026-10-01", sourceEnd: "2026-10-15", correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: 10201, remittance: "unfiled" },
  { code: "02", name: "same month negative unfiled", sourceStart: "2026-10-01", sourceEnd: "2026-10-15", correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: -23050, remittance: "unfiled" },
  { code: "03", name: "prior month positive unfiled", sourceStart: "2026-09-01", sourceEnd: "2026-09-15", correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: 78000, remittance: "unfiled" },
  { code: "04", name: "prior month negative unfiled", sourceStart: "2026-09-01", sourceEnd: "2026-09-15", correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: -78000, remittance: "unfiled" },
  { code: "05", name: "prior month positive submitted unposted", sourceStart: "2026-09-01", sourceEnd: "2026-09-15", correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: 32500, remittance: "submitted_unposted" },
  { code: "06", name: "prior month negative submitted unposted", sourceStart: "2026-09-01", sourceEnd: "2026-09-15", correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: -32500, remittance: "submitted_unposted" },
  { code: "07", name: "prior month positive member posted", sourceStart: "2026-09-01", sourceEnd: "2026-09-15", correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: 140000, remittance: "posted" },
  { code: "08", name: "prior month negative member posted", sourceStart: "2026-09-01", sourceEnd: "2026-09-15", correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: -140000, remittance: "posted" },
  { code: "09", name: "repeat after accepted correction", sourceStart: "2026-09-01", sourceEnd: "2026-09-15", correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: 50000, remittance: "correction_accepted" },
  { code: "10", name: "December 2024 to January 2025 SSS cutover", sourceStart: "2024-12-01", sourceEnd: "2024-12-15", correctionStart: "2025-01-16", correctionEnd: "2025-01-31", wageDeltaCentavos: 72000, remittance: "unfiled" },
  { code: "11", name: "January to February 2024 HDMF cutover", sourceStart: "2024-01-01", sourceEnd: "2024-01-15", correctionStart: "2024-02-16", correctionEnd: "2024-02-29", wageDeltaCentavos: 120000, remittance: "paid_unposted" },
  { code: "12", name: "unknown historical work month", sourceStart: null, sourceEnd: null, correctionStart: "2026-10-16", correctionEnd: "2026-10-31", wageDeltaCentavos: 75000, remittance: "unknown" },
];

function worksheet(agency: M10Agency, direction: number, revised: boolean): M10WorksheetShares {
  if (agency === "SSS") {
    return {
      agency,
      employeeRegularCentavos: 10000 + (revised ? direction * 500 : 0),
      employeeMpfCentavos: 5000,
      employerRegularCentavos: 20000 + (revised ? direction * 1000 : 0),
      employerMpfCentavos: 10000,
      employerEcCentavos: 3000,
    };
  }
  return {
    agency,
    employeeSavingsCentavos: 15000 + (revised ? direction * 500 : 0),
    employerSavingsCentavos: 15000 + (revised ? direction * 500 : 0),
  };
}

export function createM10FictionalCases(): M10ReviewInput[] {
  const rows: M10ReviewInput[] = [];
  for (const organizationId of [101, 202]) {
    for (const agency of ["SSS", "Pag-IBIG"] as const) {
      M10_FICTIONAL_SCENARIOS.forEach((scenario, index) => {
        const hasSource = scenario.sourceStart !== null;
        const direction = Math.sign(scenario.wageDeltaCentavos);
        rows.push({
          caseId: "fictional-" + organizationId + "-" + agency + "-" + scenario.code,
          agency,
          organizationId,
          employeeId: organizationId * 10 + 1,
          adjustmentId: index + 1,
          sourceRunId: hasSource ? 10_000 + organizationId * 100 + index : null,
          sourceEntryId: hasSource ? 20_000 + organizationId * 100 + index : null,
          sourceOrganizationId: organizationId,
          sourceEntryEmployeeId: organizationId * 10 + 1,
          sourceRunStatus: hasSource ? "Released" : null,
          sourcePeriodStart: scenario.sourceStart,
          sourcePeriodEnd: scenario.sourceEnd,
          correctionPeriodStart: scenario.correctionStart,
          correctionPeriodEnd: scenario.correctionEnd,
          wageDeltaCentavos: scenario.wageDeltaCentavos,
          remittanceState: scenario.remittance,
          submissionReference: scenario.remittance === "submitted_unposted" ? "SYNTH-SUB-" + scenario.code : null,
          originalReceiptReference: ["paid_unposted", "posted", "correction_accepted"].includes(scenario.remittance)
            ? "SYNTH-OR-" + scenario.code : null,
          correctionReceiptReference: scenario.remittance === "correction_accepted" ? "SYNTH-COR-" + scenario.code : null,
          originalWorksheetShares: hasSource ? worksheet(agency, direction, false) : null,
          revisedWorksheetShares: hasSource ? worksheet(agency, direction, true) : null,
        });
      });
    }
  }
  return rows;
}

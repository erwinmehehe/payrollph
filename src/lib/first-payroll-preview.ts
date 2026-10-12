import type { PayrollDryRunRow } from "./payroll-engine";
import { validJourneySchedule } from "./first-payroll-journey";

export function firstPayrollPreviewResult(rows: PayrollDryRunRow[], schedule: unknown, timeReviewed: boolean) {
  const blockers: string[] = [];
  if (!validJourneySchedule(schedule)) blockers.push("No pay schedule configured.");
  if (!rows.length) blockers.push("No active employees in this cutoff.");
  if (!timeReviewed) blockers.push("Authorized human attendance review is required for this cutoff.");
  for (const row of rows) {
    if (row.missingTin) blockers.push(`${row.name}: missing TIN.`);
    if (row.missingBank) blockers.push(`${row.name}: missing bank payout details.`);
    if (row.status === "Exception") blockers.push(`${row.name}: payroll calculation exceptions require review.`);
  }
  return { rows, blockers, previewReady: blockers.length === 0, readOnly: true as const };
}

import type { FirstPayrollReadiness } from "@/lib/first-payroll-readiness";
import { buildFirstPayrollJourney, type FirstPayrollJourneyStep } from "@/lib/first-payroll-journey";

export type PayrollPreviewFinding = { step: FirstPayrollJourneyStep; kind: "blocker" | "review" | "complete"; message: string };

export function firstPayrollPreview(readiness: FirstPayrollReadiness): PayrollPreviewFinding[] {
  return buildFirstPayrollJourney(readiness).map(step => {
    const incomplete = readiness.items.filter(item => !item.ready);
    const kind = step.state === "complete" ? "complete"
      : step.state === "upcoming" || step.state === "available" && incomplete.length ? "blocker" : "review";
    const relevant = step.key === "people"
      ? incomplete.filter(item => item.key === "employees" || item.key === "payout")
      : step.key === "reviewers"
        ? incomplete.filter(item => item.key === "payroll-officer" || item.key === "checker")
        : step.key === "company" ? incomplete.filter(item => item.key === "workspace") : [];
    return { step, kind, message: relevant.length ? relevant.map(row => row.detail).join(" ") : step.detail };
  });
}

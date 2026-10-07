import { runAutomationEventSafely } from "@/lib/automation";

export type ContributionDiscrepancySource =
  | "employee_report"
  | "statutory_posting_import";

export async function emitContributionDiscrepancyAutomation(input: {
  organizationId: number;
  employeeId: number;
  legalEntityId: number;
  caseId: number;
  issueType: string;
  agency: string;
  applicableMonth: string;
  source: ContributionDiscrepancySource;
  severity: "warning" | "danger";
  batchId?: number | null;
  remittanceMemberId?: number | null;
  evidenceArtifactId?: number | null;
}) {
  try {
    return await runAutomationEventSafely({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      trigger: "contribution.discrepancy_detected",
      eventKey: `contribution-discrepancy-detected:${input.caseId}`,
      context: {
        contributionCaseId: input.caseId,
        legalEntityId: input.legalEntityId,
        contributionIssueType: input.issueType,
        contributionSource: input.source,
        contributionSeverity: input.severity,
        statutoryAgency: input.agency,
        applicableMonth: input.applicableMonth,
        batchId: input.batchId ?? null,
        remittanceMemberId: input.remittanceMemberId ?? null,
        evidenceArtifactId: input.evidenceArtifactId ?? null,
      },
    });
  } catch (error) {
    return [{
      status: "engine_error",
      error: error instanceof Error
        ? error.message.slice(0, 4000)
        : "Contribution discrepancy automation failed.",
    }];
  }
}

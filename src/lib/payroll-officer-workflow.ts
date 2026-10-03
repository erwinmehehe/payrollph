export type PayrollOfficerWorkflowState = "done" | "now" | "attention" | "locked";

export type PayrollOfficerChecklistItem = {
  key: string;
  passed: boolean;
  blocking: boolean;
  acknowledgeable?: boolean;
  detail: string;
};

export function buildPayrollOfficerWorkflow(input: {
  runStatus: string;
  calculated: boolean;
  processedChunks?: number | null;
  totalChunks?: number | null;
  exceptionCount: number;
  approvalStatus?: string | null;
  checklist?: PayrollOfficerChecklistItem[] | null;
}) {
  const hasChecklist = input.checklist != null;
  const checklist = new Map((input.checklist ?? []).map((item) => [item.key, item]));
  const inputChecks = ["inputs", "attendance"].map((key) => checklist.get(key)).filter(Boolean) as PayrollOfficerChecklistItem[];
  const inputIssues = inputChecks.filter((item) => !item.passed);
  const calculationCheck = checklist.get("calculation");
  const statutoryCheck = checklist.get("statutory");
  const exceptionCheck = checklist.get("exceptions");

  const chunksComplete = input.totalChunks
    ? Number(input.processedChunks ?? 0) >= Number(input.totalChunks)
    : input.calculated;
  const calculationReady = Boolean(input.calculated && chunksComplete && (calculationCheck?.passed ?? true));
  const exceptionIssues =
    input.exceptionCount +
    (statutoryCheck && !statutoryCheck.passed ? 1 : 0) +
    (exceptionCheck && !exceptionCheck.passed && input.exceptionCount === 0 ? 1 : 0);

  const submitted = input.runStatus === "Pending approval" || input.approvalStatus === "Pending";
  const approved = input.runStatus === "Ready for release" || input.approvalStatus === "Approved";
  const released = input.runStatus === "Released";
  const canSubmit =
    calculationReady
    && inputIssues.length === 0
    && !submitted
    && !approved
    && !released
    && ["Processed", "Needs review"].includes(input.runStatus);

  return {
    inputIssues,
    calculationReady,
    exceptionIssues,
    canSubmit,
    steps: {
      inputs: {
        state: !hasChecklist ? "now" as const : inputIssues.length > 0 ? "attention" as const : "done" as const,
      },
      calculate: {
        state: calculationReady ? "done" as const : "now" as const,
      },
      exceptions: {
        state: !calculationReady
          ? "locked" as const
          : exceptionIssues > 0
            ? "attention" as const
            : "done" as const,
      },
      submit: {
        state: approved || released
          ? "done" as const
          : submitted
            ? "now" as const
            : calculationReady && inputIssues.length === 0
              ? "now" as const
              : "locked" as const,
      },
    },
  };
}

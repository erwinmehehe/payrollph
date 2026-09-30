import type { AuditEvent } from "@/components/workspace/types";

export type PayrollPayoutState = {
  release: {
    done: boolean;
    at: string | null;
  };
  bankFile: {
    status: "waiting" | "generated";
    filename: string | null;
    template: string | null;
    generatedAt: string | null;
  };
  payout: {
    status: "waiting-for-file" | "ready" | "submitted" | "completed";
    label: string;
    reference: string | null;
    method: string | null;
    completedAt: string | null;
  };
};

function metadata(event: AuditEvent) {
  return event.metadata && typeof event.metadata === "object"
    ? event.metadata as Record<string, unknown>
    : {};
}

function belongsToRun(event: AuditEvent, runId: number) {
  return Number(metadata(event).runId) === runId;
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function derivePayrollPayoutState(events: AuditEvent[], runId: number): PayrollPayoutState {
  const relevant = events
    .filter((event) => belongsToRun(event, runId))
    .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());

  const release = relevant.find((event) => event.action === "Payroll release receipt");
  const bankFile = relevant.find((event) => {
    const meta = metadata(event);
    return event.action === "bank export generated" && meta.kind === "bank" && meta.dryRun !== true;
  });

  const manualCompletion = relevant.find((event) => event.action === "Payroll payout completed manually");
  const providerCompletion = relevant.find((event) => event.action === "Payroll payout completed via PayMongo");
  const providerSubmission = relevant.find((event) => event.action === "Payroll payout submitted via PayMongo");
  const completion = manualCompletion ?? providerCompletion;
  const completionMeta = completion ? metadata(completion) : {};
  const submissionMeta = providerSubmission ? metadata(providerSubmission) : {};

  const bankMeta = bankFile ? metadata(bankFile) : {};

  return {
    release: {
      done: Boolean(release),
      at: release ? iso(release.createdAt) : null,
    },
    bankFile: {
      status: bankFile ? "generated" : "waiting",
      filename: typeof bankMeta.filename === "string" ? bankMeta.filename : null,
      template: typeof bankMeta.template === "string" ? bankMeta.template : null,
      generatedAt: bankFile ? iso(bankFile.createdAt) : null,
    },
    payout: completion
      ? {
          status: "completed",
          label: completion.action === "Payroll payout completed manually"
            ? "Payout completion recorded from bank confirmation"
            : "PayMongo reported every transfer complete",
          reference:
            typeof completionMeta.reference === "string"
              ? completionMeta.reference
              : typeof completionMeta.batchId === "string"
                ? completionMeta.batchId
                : null,
          method:
            typeof completionMeta.method === "string"
              ? completionMeta.method
              : completion.action.includes("PayMongo")
                ? "PayMongo"
                : null,
          completedAt: typeof completionMeta.completedAt === "string"
            ? completionMeta.completedAt
            : iso(completion.createdAt),
        }
      : providerSubmission
        ? {
            status: "submitted",
            label: "PayMongo batch submitted; completion is not yet confirmed",
            reference: typeof submissionMeta.batchId === "string" ? submissionMeta.batchId : null,
            method: "PayMongo",
            completedAt: null,
          }
        : bankFile
          ? {
              status: "ready",
              label: "Bank file generated; record the bank confirmation after payout",
              reference: null,
              method: null,
              completedAt: null,
            }
          : {
              status: "waiting-for-file",
              label: "Generate the final bank file before recording payout completion",
              reference: null,
              method: null,
              completedAt: null,
            },
  };
}

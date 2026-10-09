import type { FirstPayrollReadiness } from "./first-payroll-readiness";

/**
 * Read-only overview of the first real-employer payroll pilot.
 *
 * The dashboard cannot prove source data migration, employee-by-employee
 * comparison, bank settlement, agency acceptance or independent certification.
 * This model deliberately never infers any of those from a green setup card,
 * a Released payroll run or an owner-attested audit event.
 */
export type PilotStageState =
  | "recorded"
  | "action-required"
  | "operator-review"
  | "owner-attested"
  | "separate-evidence";

export type PilotPage =
  | "Settings"
  | "People"
  | "Migration"
  | "Payroll"
  | "Readiness";

export type PilotStage = {
  key: "setup" | "migration" | "run" | "reconciliation" | "external";
  title: string;
  description: string;
  state: PilotStageState;
  actionPage?: PilotPage;
  actionLabel?: string;
  settingsSection?: "organization" | "team";
};

type Run = {
  id: number;
  status: string;
  periodLabel: string;
  employeeCount: number;
};
type Event = { action: string; metadata: unknown };

export type PilotJourney = {
  stages: PilotStage[];
  nextStageKey: PilotStage["key"];
  latestRunId: number | null;
  latestPeriodLabel: string | null;
  latestRunStatus: string | null;
  attestationMode: "no-money-bank-file-dry-run" | "completed-payout" | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Owner sign-off is an audit record, not independent verification of its source
 * files. Bind it to the newest exact run; do not count a prior period's record.
 */
function findAttestation(
  events: Event[],
  latestRun: Run | null,
): PilotJourney["attestationMode"] {
  if (!latestRun || latestRun.status !== "Released") return null;
  for (const event of events) {
    if (event.action !== "Production payroll pilot signed off" || !isRecord(event.metadata)) {
      continue;
    }
    if (
      event.metadata.runId !== latestRun.id
      || (event.metadata.payoutEvidenceMode !== "no-money-bank-file-dry-run"
        && event.metadata.payoutEvidenceMode !== "completed-payout")
    ) {
      continue;
    }
    return event.metadata.payoutEvidenceMode;
  }
  return null;
}

export function buildFirstPayrollPilotJourney(input: {
  readiness: FirstPayrollReadiness | null | undefined;
  payrollRuns: Run[];
  auditEvents: Event[];
}): PilotJourney {
  const latestRun =
    input.payrollRuns
      .filter((run) => Number.isSafeInteger(run.id) && run.id > 0)
      .sort((a, b) => b.id - a.id)[0] ?? null;
  const latestReleased = latestRun?.status === "Released";
  const attestationMode = findAttestation(input.auditEvents, latestRun);
  const pendingSetup = input.readiness?.items.find((item) => !item.ready);
  const setupPage: PilotPage = pendingSetup?.actionPage ?? "Settings";
  const setupSection =
    pendingSetup?.key === "workspace" ? "organization" : "team";

  const stages: PilotStage[] = [
    {
      key: "setup",
      title: "Configure the workspace and review roles",
      description: input.readiness?.ready
        ? String(input.readiness.completed) + "/" + String(input.readiness.total)
          + " workspace setup checks are recorded. This is not payroll readiness."
        : input.readiness
          ? String(input.readiness.completed) + "/" + String(input.readiness.total)
            + " setup checks recorded. "
            + (pendingSetup?.detail ?? "Finish the workspace setup checklist.")
          : "Workspace setup evidence is unavailable; review the organization and access roles.",
      state: input.readiness?.ready ? "recorded" : "action-required",
      actionPage: setupPage,
      actionLabel: pendingSetup?.actionLabel ?? "Review setup",
      settingsSection: setupSection,
    },
    {
      key: "migration",
      title: "Import and inspect source payroll data",
      description:
        "Use the existing migration center for roster, prior payroll history, leave and loans where applicable. "
        + "A populated roster does not prove that old balances or pay rules were reconciled.",
      state: "operator-review",
      actionPage: "Migration",
      actionLabel: "Review migration",
    },
    {
      key: "run",
      title: "Prepare, calculate and review a payroll period",
      description: !latestRun
        ? "No payroll run is recorded. Review employee pay inputs, attendance, statutory rules and maker-checker roles before creating one."
        : latestReleased
          ? "Run #" + String(latestRun.id) + " (" + latestRun.periodLabel
            + ") has a Released record. That does not prove correct calculation, bank payment or government acceptance."
          : "Run #" + String(latestRun.id) + " (" + latestRun.periodLabel
            + ") is " + latestRun.status
            + ". Complete input review, exception resolution and required approvals before release.",
      state: latestReleased ? "recorded" : "action-required",
      actionPage: "Payroll",
      actionLabel: latestRun ? "Open payroll run" : "Prepare payroll",
    },
    {
      key: "reconciliation",
      title: "Reconcile against an independent payroll source",
      description: attestationMode === "no-money-bank-file-dry-run"
        ? "An owner-attested no-money pilot record is linked to the latest run. "
          + "It does not prove bank settlement or independently authenticate the private reviewer evidence."
        : attestationMode === "completed-payout"
          ? "A completed-payout attestation is linked to the latest run. "
            + "Bank and independent reviewer evidence still require external authentication."
          : latestReleased
            ? "Compare every employee, statutory liability, net total and GL bridge to independent employer records. "
              + "Keep private evidence off GitHub; use the owner sign-off card only after review."
            : "Independent comparison follows a reviewed no-money payroll rehearsal and bank-file dry run. "
              + "A simulation or worksheet alone cannot authorize payment.",
      state: attestationMode ? "owner-attested" : latestReleased ? "action-required" : "operator-review",
      actionPage: latestReleased ? undefined : "Payroll",
      actionLabel: latestReleased ? undefined : "Review payroll",
    },
    {
      key: "external",
      title: "Complete separate production and statutory gates",
      description:
        "Real email delivery, government file acceptance, authorized bank UAT, recovery, privacy review "
        + "and independent employer sign-off are separate requirements. This overview cannot certify them.",
      state: "separate-evidence",
      actionPage: "Readiness",
      actionLabel: "View rollout gates",
    },
  ];

  const nextStageKey: PilotStage["key"] =
    !input.readiness?.ready
      ? "setup"
      : !latestRun || !latestReleased
        ? "run"
        : !attestationMode
          ? "reconciliation"
          : "external";

  return {
    stages,
    nextStageKey,
    latestRunId: latestRun?.id ?? null,
    latestPeriodLabel: latestRun?.periodLabel ?? null,
    latestRunStatus: latestRun?.status ?? null,
    attestationMode,
  };
}

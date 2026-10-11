import type { Employee, LeaveRequest } from "@/components/workspace/types";
import type { WorkerJourneyStage } from "@/lib/hcm-worker-journey";

/**
 * Read-only, source-linked summary for the existing People drawer.
 * Never treat a missing link, an empty preview, or a failed HCM fetch as a
 * completed HR process, an exhaustive history, or independent compliance proof.
 */
export type Employee360SourceState = "loading" | "ready" | "unavailable" | "restricted";

export type Employee360ConnectedSnapshot = {
  position: null | {
    profile: null | { title: string };
    orgUnit: null | { name: string };
    manager: null | { firstName: string; lastName: string };
  };
  summary: {
    pendingPolicyAcknowledgements: number;
    documentComplianceRisks: number;
  };
  history: {
    employmentEvents: readonly unknown[];
    positionAssignments: readonly unknown[];
  };
  journey: {
    stages: readonly Pick<WorkerJourneyStage, "id" | "state" | "detail">[];
  };
};

export type Employee360CardId =
  | "employment" | "onboarding" | "documents" | "leave" | "performance" | "compensation" | "payroll" | "history";

export type Employee360Card = {
  id: Employee360CardId;
  title: string;
  value: string;
  detail: string;
  source: string;
  targetId: string;
  available: boolean;
  tone: "neutral" | "attention" | "unavailable";
};

function stageLabel(value: WorkerJourneyStage["state"]): string {
  switch (value) {
    case "recorded": return "Recorded";
    case "in_progress": return "In progress";
    case "attention": return "Needs review";
    case "not_recorded": return "Not linked";
    case "not_applicable": return "Not applicable";
    case "restricted": return "Restricted";
  }
}

function sourceUnavailable(state: Employee360SourceState): { value: string; detail: string } {
  if (state === "restricted") return {
    value: "Restricted",
    detail: "Connected HR evidence is not available to this role.",
  };
  if (state === "loading") return {
    value: "Loading",
    detail: "Checking the selected worker's authorized records.",
  };
  return {
    value: "Unavailable",
    detail: "Connected HR evidence could not be loaded; no completion is inferred.",
  };
}

function unavailableCard(
  id: Employee360CardId,
  title: string,
  state: Employee360SourceState,
): Employee360Card {
  return {
    id, title, ...sourceUnavailable(state), targetId: "employee-360-" + id,
    available: false, tone: "unavailable", source: "Connected HCM records",
  };
}

export function buildEmployee360Overview({
  employee,
  leave,
  profile,
  profileState,
}: {
  employee: Pick<Employee, "title" | "status" | "employmentType">;
  leave: readonly Pick<LeaveRequest, "status">[];
  profile: Employee360ConnectedSnapshot | null;
  profileState: Employee360SourceState;
}): Employee360Card[] {
  const ready = profileState === "ready" && profile !== null;
  const active = ready ? profile : null;
  const resolvedState: Employee360SourceState = ready ? "ready" :
    profileState === "ready" ? "unavailable" : profileState;
  const manager = active?.position?.manager;
  const managerText = manager ? manager.firstName + " " + manager.lastName : "Manager not recorded";
  const orgText = active?.position?.orgUnit?.name ?? "Organization unit not recorded";

  const employment: Employee360Card = {
    id: "employment",
    title: "Employment",
    value: active?.position?.profile?.title || employee.title || "Job title not recorded",
    detail: active
      ? employee.status + " · " + orgText + " · " + managerText
      : employee.status + " · " + employee.employmentType + " · current employee record",
    source: "Current employee record" + (active ? " and linked position" : ""),
    targetId: "employee-360-employment",
    available: true,
    tone: "neutral",
  };

  const pendingLeave = leave.filter((request) => request.status === "Pending").length;
  const leaveCard: Employee360Card = {
    id: "leave", title: "Leave",
    value: pendingLeave + " pending in snapshot",
    detail: leave.length + " request record(s) loaded. This is not an exhaustive leave balance.",
    source: "Currently loaded leave request records",
    targetId: "employee-360-leave",
    available: true,
    tone: pendingLeave > 0 ? "attention" : "neutral",
  };

  if (!active) return [
    employment,
    unavailableCard("onboarding", "Onboarding", resolvedState),
    unavailableCard("documents", "Documents", resolvedState),
    leaveCard,
    unavailableCard("performance", "Performance", resolvedState),
    unavailableCard("compensation", "Compensation", resolvedState),
    unavailableCard("payroll", "Payroll evidence", resolvedState),
    unavailableCard("history", "Employment history", resolvedState),
  ];

  const onboarding = active.journey.stages.find((stage) => stage.id === "onboarding");
  const performance = active.journey.stages.find((stage) => stage.id === "performance");
  const compensation = active.journey.stages.find((stage) => stage.id === "compensation");
  const payroll = active.journey.stages.find((stage) => stage.id === "payroll");
  const policies = active.summary.pendingPolicyAcknowledgements;
  const documents = active.summary.documentComplianceRisks;
  const documentsFlagged = policies + documents;
  const historyEvents = active.history.employmentEvents.length;
  const historyAssignments = active.history.positionAssignments.length;

  return [
    employment,
    onboarding ? {
      id: "onboarding", title: "Onboarding",
      value: stageLabel(onboarding.state),
      detail: onboarding.detail,
      source: "Linked onboarding checklist evidence",
      targetId: "employee-360-onboarding", available: true,
      tone: onboarding.state === "attention" ? "attention" : "neutral",
    } : unavailableCard("onboarding", "Onboarding", "unavailable"),
    {
      id: "documents", title: "Documents",
      value: documentsFlagged + " flagged in source",
      detail: documentsFlagged
        ? policies + " policy acknowledgements · " + documents + " document items"
        : "No flagged items in connected source; not a compliance certification.",
      source: "Policy and document compliance records",
      targetId: "employee-360-documents", available: true,
      tone: documentsFlagged > 0 ? "attention" : "neutral",
    },
    leaveCard,
    performance ? {
      id: "performance", title: "Performance",
      value: stageLabel(performance.state),
      detail: performance.detail,
      source: "Linked performance reviews and goals",
      targetId: "employee-360-performance", available: true,
      tone: performance.state === "attention" ? "attention" : "neutral",
    } : unavailableCard("performance", "Performance", "unavailable"),
    // Proposal evidence never authorizes a raise. When restricted, even the
    // source description is withheld from the Employee 360 summary.
    compensation?.state === "restricted"
      ? unavailableCard("compensation", "Compensation", "restricted")
      : compensation ? {
          id: "compensation", title: "Compensation",
          value: stageLabel(compensation.state),
          detail: compensation.detail,
          source: "Linked governed compensation proposal",
          targetId: "employee-360-compensation", available: true,
          tone: compensation.state === "attention" || compensation.state === "in_progress"
            ? "attention" : "neutral",
        } : unavailableCard("compensation", "Compensation", "unavailable"),
    // Released payroll evidence is not disbursement or bank settlement.
    payroll?.state === "restricted"
      ? unavailableCard("payroll", "Payroll evidence", "restricted")
      : payroll ? {
          id: "payroll", title: "Payroll evidence",
          value: stageLabel(payroll.state),
          detail: payroll.detail,
          source: "Authorized released payroll entry",
          targetId: "employee-360-payroll", available: true,
          tone: payroll.state === "attention" || payroll.state === "in_progress"
            ? "attention" : "neutral",
        } : unavailableCard("payroll", "Payroll evidence", "unavailable"),
    {
      id: "history", title: "Employment history",
      value: historyEvents + " events shown",
      detail: historyAssignments + " position assignment(s) shown. Linked preview may omit older history.",
      source: "Linked employment events and position assignments",
      targetId: "employee-360-history", available: true,
      tone: "neutral",
    },
  ];
}

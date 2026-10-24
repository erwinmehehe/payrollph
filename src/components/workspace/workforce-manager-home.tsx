"use client";

import { CalendarRange, CheckCheck, Clock3, UsersRound } from "lucide-react";
import { WorkforceLiveFloor } from "./workforce-live-floor";
import { WorkforceOperationsInbox } from "./workforce-operations-inbox";

export type WorkforceDestination = "team" | "coverage" | "timesheets" | "overtime" | "swaps" | "bulk";

export function WorkforceManagerHome({
  organizationId, mode, canReviewBatches, onOpenTab, onOpenAttendance,
}: {
  organizationId: number;
  mode: "today" | "approvals";
  canReviewBatches: boolean;
  onOpenTab: (tab: WorkforceDestination, period?: { periodStart: string; periodEnd: string }) => void;
  onOpenAttendance: () => void;
}) {
  const actions = mode === "today" ? [
    { tab: "team" as const, title: "Plan the week", detail: "Review shifts, rest days and recorded leave.", icon: CalendarRange },
    { tab: "coverage" as const, title: "Fill a coverage gap", detail: "Compare eligible replacements and stage a proposal.", icon: UsersRound },
    { tab: "timesheets" as const, title: "Prepare time for payroll", detail: "Review the exact cutoff and approved time evidence.", icon: Clock3 },
  ] : [
    { tab: "coverage" as const, title: "Open-shift claims", detail: "Review eligibility and staffing before assigning a shift.", icon: UsersRound },
    { tab: "swaps" as const, title: "Schedule swaps", detail: "Review requested exchanges and schedule conflicts.", icon: CalendarRange },
    { tab: "overtime" as const, title: "Overtime requests", detail: "Review authorization separately from recorded work.", icon: Clock3 },
    { tab: "timesheets" as const, title: "Timesheet review", detail: "Approve the current version or return it for correction.", icon: CheckCheck },
    ...(canReviewBatches ? [{ tab: "bulk" as const, title: "Roster batch review", detail: "Open staged changes for a separate checker to review.", icon: CalendarRange }] : []),
  ];

  return (
    <section className="workspace-panel workforce-manager" data-wfm-manager-home={mode} aria-label={mode === "today" ? "Today’s workforce" : "Workforce approval reviews"}>
      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">{mode === "today" ? "Your working day" : "Review and decide"}</div>
            <h2>{mode === "today" ? "Keep the team’s day moving." : "Bring each request to the right review."}</h2>
            <p>{mode === "today" ? "Check recorded time, plan coverage and resolve issues before the cutoff." : "Open the original request to inspect its evidence and make a decision."}</p>
          </div>
        </div>
        <div className="workforce-action-grid">
          {actions.map(({ tab, title, detail, icon: Icon }) => (
            <button key={tab} type="button" className="workspace-choice workforce-action" onClick={() => onOpenTab(tab)}>
              <Icon size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span><strong style={{ display: "block" }}>{title} →</strong><span style={{ display: "block", marginTop: 6, fontWeight: 400 }}>{detail}</span></span>
            </button>
          ))}
          {mode === "approvals" && <button type="button" className="workspace-choice workforce-action" onClick={onOpenAttendance}>
            <Clock3 size={18} aria-hidden="true" /><span><strong style={{ display: "block" }}>Attendance corrections →</strong><span style={{ display: "block", marginTop: 6, fontWeight: 400 }}>Inspect the original punch and correction evidence.</span></span>
          </button>}
        </div>
      </article>
      {mode === "today" && <WorkforceLiveFloor organizationId={organizationId} onOpenAttendance={onOpenAttendance} />}
      <WorkforceOperationsInbox organizationId={organizationId} onOpenAttendance={onOpenAttendance} onOpenTab={onOpenTab} />
    </section>
  );
}

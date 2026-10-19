"use client";

import { ArrowLeftRight, ArrowRight, CalendarDays, Clock3, UsersRound } from "lucide-react";

export type WorkforceQuickTab = "team" | "coverage" | "swaps" | "timesheets";

/**
 * Shortcuts into existing, independently authorized WFM workflows.
 * Navigation is not a staffing recommendation or an approval decision.
 */
export const WORKFORCE_QUICK_TASKS = [
  { tab: "team", label: "Weekly roster", detail: "Check shifts, rest days and recorded leave.", icon: CalendarDays },
  { tab: "coverage", label: "Coverage gaps", detail: "Review open shifts and eligible staff.", icon: UsersRound },
  { tab: "swaps", label: "Swap requests", detail: "Inspect proposed exchanges and decisions.", icon: ArrowLeftRight },
  { tab: "timesheets", label: "Timesheet review", detail: "Review the selected cutoff and timecard blockers.", icon: Clock3 },
] as const;

export function WorkforceWorkflowShortcuts({
  activeTab, onNavigate,
}: {
  activeTab: string;
  onNavigate: (tab: WorkforceQuickTab) => void;
}) {
  return (
    <nav aria-label="Workforce task shortcuts" data-wfm-workflow-shortcuts
      className="rounded-xl border p-3" style={{ marginTop: 12, borderColor: "var(--line)" }}>
      <p className="text-xs" style={{ margin: "0 0 10px", color: "var(--muted)" }}>
        <strong>Everyday workflow</strong> · Jump directly between tasks. Review and approval remain in their original screens.
      </p>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))" }}>
        {WORKFORCE_QUICK_TASKS.map((task, index) => {
          const Icon = task.icon;
          const active = task.tab === activeTab;
          return (
            <button key={task.tab} type="button" className="secondary-button"
              data-wfm-task={task.tab} aria-pressed={active} onClick={() => onNavigate(task.tab)}
              style={{ padding: 12, minWidth: 0, whiteSpace: "normal", textAlign: "left",
                alignItems: "flex-start", gap: 10,
                background: active ? "var(--canvas-subtle)" : undefined }}>
              <Icon size={17} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 13 }}>{index + 1}. {task.label}</strong>
                <span style={{ display: "block", fontSize: 12, fontWeight: 400, marginTop: 4 }}>{task.detail}</span>
              </span>
              <ArrowRight size={15} aria-hidden="true" style={{ flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
      <p className="text-xs" style={{ margin: "10px 0 0", color: "var(--muted)" }}>
        Switching tools never publishes shifts, approves a timecard or releases payroll.
      </p>
    </nav>
  );
}

"use client";

import { ArrowUpRight, UsersRound } from "lucide-react";
import type { PayrollRun } from "./types";

const peso = (value: string | number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

function statusTone(status: string) {
  const value = status.toLowerCase();
  if (value.includes("released") || value.includes("paid")) return "released";
  if (value.includes("approved") || value.includes("ready")) return "ready";
  if (value.includes("exception") || value.includes("failed") || value.includes("blocked")) return "danger";
  return "approval";
}

export function RecentPayrollRuns({
  runs,
  onViewAll,
}: {
  runs: PayrollRun[];
  onViewAll: () => void;
}) {
  return (
    <section className="dashboard-payroll-card">
      <header>
        <div>
          <span className="dashboard-section-kicker">Payroll history</span>
          <h2>Recent payrolls</h2>
        </div>
        <button type="button" className="dashboard-table-link" onClick={onViewAll}>
          View all <ArrowUpRight size={13} aria-hidden />
        </button>
      </header>

      <div className="dashboard-payroll-list">
        {runs.slice(0, 3).map((run) => (
          <button type="button" className="dashboard-payroll-row" key={run.id} onClick={onViewAll}>
            <div className="dashboard-payroll-period">
              <strong>{run.periodLabel}</strong>
              <span>{run.scopeLabel || "Regular payroll"}</span>
            </div>
            <span className="dashboard-payroll-people"><UsersRound size={13} aria-hidden /> {run.employeeCount}</span>
            <strong className="dashboard-payroll-amount">{peso(run.netPay)}</strong>
            <span className="dashboard-run-status" data-tone={statusTone(run.status)}>
              {run.status}
            </span>
            <ArrowUpRight className="dashboard-payroll-row-arrow" size={14} aria-hidden />
          </button>
        ))}
        {runs.length === 0 ? <div className="dashboard-table-empty">No payroll runs yet.</div> : null}
      </div>
    </section>
  );
}

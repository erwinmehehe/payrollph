"use client";

import { ArrowUpRight } from "lucide-react";
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
          <h2>Recent Payroll Runs</h2>
        </div>
        <button type="button" className="dashboard-table-link" onClick={onViewAll}>
          View all <ArrowUpRight size={13} aria-hidden />
        </button>
      </header>

      <div className="dashboard-payroll-table-wrap">
        <table className="dashboard-payroll-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Type</th>
              <th>Employees</th>
              <th>Total Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 3).map((run) => (
              <tr key={run.id}>
                <td><strong>{run.periodLabel}</strong></td>
                <td>{run.scopeLabel || "Regular payroll"}</td>
                <td>{run.employeeCount}</td>
                <td className="num">{peso(run.netPay)}</td>
                <td>
                  <span className="dashboard-run-status" data-tone={statusTone(run.status)}>
                    {run.status}
                  </span>
                </td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={5} className="dashboard-table-empty">No payroll runs yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

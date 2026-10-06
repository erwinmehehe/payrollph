"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, FileSearch, RefreshCw, UserRound } from "lucide-react";
import { money } from "./ui";

type VarianceCategory =
  | "exception"
  | "salary_change"
  | "overtime_spike"
  | "retro"
  | "new_hire"
  | "new_to_run"
  | "separation"
  | "missing_from_run"
  | "bank_details"
  | "statutory"
  | "net_variance";

type VarianceRow = {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  employeeStatus: string;
  entryStatus: string;
  categories: VarianceCategory[];
  currentGross: number;
  previousGross: number | null;
  currentNet: number;
  previousNet: number | null;
  netDelta: number | null;
  netPercent: number | null;
  changedLines: Array<{
    code: string;
    label: string;
    previous: number | null;
    current: number;
    delta: number | null;
    netEffectDelta: number | null;
    reason: string;
  }>;
};

type VariancePayload = {
  run: {
    id: number;
    periodLabel: string;
    grossPay: number;
    netPay: number;
  };
  previousRun: null | {
    id: number;
    periodLabel: string;
    grossPay: number;
    netPay: number;
  };
  summary: {
    changedEmployees: number;
    totalEmployeesReviewed: number;
    exceptionCount: number;
    grossDelta: number;
    netDelta: number;
    categoryCounts: Record<VarianceCategory, number>;
  };
  rows: VarianceRow[];
};

const CATEGORY_LABELS: Record<VarianceCategory, string> = {
  exception: "Payroll exception",
  salary_change: "Salary change",
  overtime_spike: "Overtime spike",
  retro: "Retro adjustment",
  new_hire: "New hire",
  new_to_run: "New to payroll",
  separation: "Separation",
  missing_from_run: "Missing from run",
  bank_details: "Payout details changed",
  statutory: "Statutory change",
  net_variance: "Net pay changed",
};

function percentChange(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function PayrollVarianceInsights({
  runId,
  onExplainEmployee,
  onOpenEmployee,
}: {
  runId: number;
  onExplainEmployee: (employeeId: number) => void;
  onOpenEmployee?: (employeeId: number) => void;
}) {
  const [payload, setPayload] = useState<VariancePayload | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setError("");
    (async () => {
      try {
        const response = await fetch(`/api/payroll-runs/${runId}/variance`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!alive) return;
        if (!response.ok) {
          setPayload(null);
          setError(body.error ?? "Could not compare this payroll with the previous released run.");
          return;
        }
        setPayload(body as VariancePayload);
      } catch {
        if (alive) {
          setPayload(null);
          setError("Could not load payroll changes.");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId, refreshKey]);

  const meaningfulCategories = useMemo(() => {
    if (!payload) return [];
    const counts = payload.summary.categoryCounts;
    return ([
      "salary_change",
      "overtime_spike",
      "retro",
      "new_hire",
      "separation",
      "statutory",
    ] as VarianceCategory[])
      .map((category) => ({ category, count: counts[category] ?? 0 }))
      .filter((item) => item.count > 0)
      .slice(0, 4);
  }, [payload]);

  if (error) {
    return (
      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">WHAT CHANGED?</div>
            <h2>Payroll comparison is unavailable</h2>
            <p>{error}</p>
          </div>
          <button className="secondary-button" onClick={() => setRefreshKey((value) => value + 1)}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </article>
    );
  }

  if (!payload) {
    return (
      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">WHAT CHANGED?</div>
            <h2>Comparing this payroll…</h2>
            <p>Checking the current register against the previous released cutoff.</p>
          </div>
        </div>
      </article>
    );
  }

  const prior = payload.previousRun;
  const netPercent = prior ? percentChange(payload.run.netPay, prior.netPay) : null;
  const higher = payload.summary.netDelta >= 0;
  const topRows = payload.rows
    .filter((row) => row.categories.some((category) => category !== "net_variance"))
    .slice(0, 6);

  return (
    <article className="card" style={{ marginBottom: 16 }} data-payroll-variance-insights>
      <div className="card-header">
        <div>
          <div className="card-kicker">WHAT CHANGED?</div>
          <h2>
            {prior
              ? `Payroll is ${Math.abs(netPercent ?? 0).toFixed(1)}% ${higher ? "higher" : "lower"} than the previous cutoff`
              : "This is the first comparable payroll"}
          </h2>
          <p>
            {prior
              ? `${payload.run.periodLabel} compared with ${prior.periodLabel}. Focus on meaningful changes instead of re-checking every employee.`
              : "There is no previous released payroll in the same scope yet. Employee-level changes will appear here after a comparable run exists."}
          </p>
        </div>
        {prior && (
          <span className={higher ? "status status-review" : "status status-approved"}>
            {higher ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {higher ? "+" : "-"}{money(Math.abs(payload.summary.netDelta))}
          </span>
        )}
      </div>

      {prior && (
        <>
          <div className="run-stats" style={{ margin: "0 16px 16px" }}>
            <div>
              <span>Current net payroll</span>
              <strong>{money(payload.run.netPay)}</strong>
              <small>{payload.run.periodLabel}</small>
            </div>
            <div>
              <span>Previous net payroll</span>
              <strong>{money(prior.netPay)}</strong>
              <small>{prior.periodLabel}</small>
            </div>
            <div>
              <span>Employees with changes</span>
              <strong>{payload.summary.changedEmployees}</strong>
              <small>of {payload.summary.totalEmployeesReviewed} reviewed</small>
            </div>
          </div>

          {meaningfulCategories.length > 0 && (
            <div className="payroll-focus-summary" style={{ margin: "0 16px 16px" }}>
              {meaningfulCategories.map(({ category, count }) => (
                <div key={category}>
                  <span>{CATEGORY_LABELS[category]}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          )}

          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="line-title" style={{ margin: 0 }}>
              <div>
                <strong>Changes worth reviewing</strong>
                <span>Largest or categorized employee changes first</span>
              </div>
              <span>{topRows.length} shown</span>
            </div>

            {topRows.length === 0 ? (
              <div className="empty-state small" style={{ marginTop: 12 }}>
                No material employee-level change needs review.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {topRows.map((row) => {
                  const primaryLine = [...row.changedLines]
                    .sort((a, b) => Math.abs(b.netEffectDelta ?? 0) - Math.abs(a.netEffectDelta ?? 0))[0];
                  const positive = Number(row.netDelta ?? 0) >= 0;
                  return (
                    <div className="exception-row" key={row.employeeId} style={{ alignItems: "flex-start" }}>
                      <span className="attention-icon" aria-hidden>
                        {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong>{row.employeeName} <span className="mono" style={{ opacity: .65, fontWeight: 500 }}>{row.employeeNo}</span></strong>
                        <p>
                          {row.netDelta == null
                            ? "New comparison context for this employee."
                            : `Net pay ${positive ? "increased" : "decreased"} by ${money(Math.abs(row.netDelta))}`}
                          {row.netPercent == null ? "" : ` (${Math.abs(row.netPercent).toFixed(1)}%)`}.
                          {primaryLine ? ` Main driver: ${primaryLine.reason}` : ""}
                        </p>
                        <small style={{ color: "var(--muted)" }}>
                          {row.categories
                            .filter((category) => category !== "net_variance")
                            .slice(0, 3)
                            .map((category) => CATEGORY_LABELS[category])
                            .join(" · ")}
                        </small>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {onOpenEmployee && (
                          <button className="secondary-button" onClick={() => onOpenEmployee(row.employeeId)}>
                            <UserRound size={13} /> Employee
                          </button>
                        )}
                        <button className="secondary-button" onClick={() => onExplainEmployee(row.employeeId)}>
                          <FileSearch size={13} /> Explain pay
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {payload.summary.changedEmployees > topRows.length && (
              <button className="link-button" style={{ marginTop: 12 }} onClick={() => topRows[0] && onExplainEmployee(topRows[0].employeeId)}>
                Review employee pay explanations <ArrowRight size={13} />
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}

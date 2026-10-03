"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  History,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import type { PayrollRun, Task } from "./types";
import { money, Spinner, Status } from "./ui";

type Category =
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
  categories: Category[];
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
  payRevision: null | {
    effectiveDate: string;
    previousPayBasis: string;
    previousRateAmount: string;
    newPayBasis: string;
    newRateAmount: string;
    reason: string;
  };
};

type VariancePayload = {
  run: {
    id: number;
    periodLabel: string;
    payDate: string;
    status: string;
    employeeCount: number;
    grossPay: number;
    netPay: number;
    ruleVersion: string;
  };
  previousRun: null | {
    id: number;
    periodLabel: string;
    payDate: string;
    employeeCount: number;
    grossPay: number;
    netPay: number;
    ruleVersion: string;
  };
  summary: {
    changedEmployees: number;
    totalEmployeesReviewed: number;
    calculatedEntries: number;
    expectedEntries: number;
    coverageComplete: boolean;
    exceptionCount: number;
    grossDelta: number;
    netDelta: number;
    categoryCounts: Record<Category, number>;
  };
  rows: VarianceRow[];
};

const categoryLabel: Record<Category, string> = {
  exception: "Exception",
  salary_change: "Salary change",
  overtime_spike: "OT spike",
  retro: "Retro",
  new_hire: "New hire",
  new_to_run: "No prior payroll",
  separation: "Separation",
  missing_from_run: "Missing from run",
  bank_details: "Bank details",
  statutory: "Statutory change",
  net_variance: "Net variance",
};

const priorityCategories: Category[] = [
  "exception",
  "salary_change",
  "overtime_spike",
  "retro",
  "new_hire",
  "separation",
  "missing_from_run",
  "bank_details",
  "statutory",
];

export function CheckerVarianceCenter({
  run,
  payrollTask,
  busy,
  canDecide,
  onDecide,
}: {
  run: PayrollRun;
  payrollTask: Task | null;
  busy: boolean;
  canDecide: boolean;
  onDecide: (id: number, status: "Approved" | "Declined") => Promise<void>;
}) {
  const [payload, setPayload] = useState<VariancePayload | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Category | "all">("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    setPayload(null);
    setError("");
    (async () => {
      try {
        const response = await fetch(`/api/payroll-runs/${run.id}/variance`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!alive) return;
        if (!response.ok) {
          setError(body.error ?? "Could not load payroll variance.");
          return;
        }
        setPayload(body);
      } catch {
        if (alive) setError("Could not load payroll variance.");
      }
    })();
    return () => { alive = false; };
  }, [run.id]);

  const visibleRows = useMemo(
    () => payload?.rows.filter((row) => filter === "all" || row.categories.includes(filter)) ?? [],
    [payload, filter],
  );

  function toggle(employeeId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  return (
    <section className="checker-variance-center" aria-label="Checker variance review">
      <div className="checker-variance-heading">
        <div>
          <div className="card-kicker">CHECKER VARIANCE REVIEW</div>
          <h2>Review only what changed.</h2>
          <p>
            Compare {run.periodLabel} with the last released payroll in the same scope. The figures below come from stored payroll entries,
            not a browser-side recalculation.
          </p>
        </div>
        <div className="checker-variance-run-status">
          <Status value={run.status} />
          <span><ShieldCheck size={13} /> Independent review</span>
        </div>
      </div>

      {error && (
        <div className="notice notice-amber">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {!error && !payload && (
        <div className="checker-variance-loading">
          <Spinner label="Comparing payrolls" />
        </div>
      )}

      {payload && (
        <>
          {!payload.summary.coverageComplete && (
            <div className="notice notice-red">
              <AlertTriangle size={15} />
              <span>
                <strong>Approval blocked.</strong>{" "}
                This run has {payload.summary.calculatedEntries}/{payload.summary.expectedEntries} stored employee entries or incomplete processing chunks.
                Finish or recalculate payroll before checker approval.
              </span>
            </div>
          )}

          <div className="checker-variance-summary">
            <div>
              <span>Changed employees</span>
              <strong>{payload.summary.changedEmployees}</strong>
              <small>of {payload.summary.totalEmployeesReviewed} reviewed</small>
            </div>
            <div>
              <span>Net payroll variance</span>
              <strong className={payload.summary.netDelta < 0 ? "red-number" : "green-number"}>
                {payload.summary.netDelta > 0 ? "+" : ""}{money(payload.summary.netDelta)}
              </strong>
              <small>{payload.previousRun ? `vs ${payload.previousRun.periodLabel}` : "No prior released run"}</small>
            </div>
            <div>
              <span>Exceptions</span>
              <strong>{payload.summary.exceptionCount}</strong>
              <small>{payload.summary.exceptionCount ? "must be understood before approval" : "no current entry exceptions"}</small>
            </div>
            <div>
              <span>Rule version</span>
              <strong>{payload.run.ruleVersion}</strong>
              <small>{payload.previousRun && payload.previousRun.ruleVersion !== payload.run.ruleVersion ? `previous: ${payload.previousRun.ruleVersion}` : "same stored ruleset context"}</small>
            </div>
          </div>

          <div className="checker-variance-filters" aria-label="Variance filters">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
              All changes <span>{payload.summary.changedEmployees}</span>
            </button>
            {priorityCategories.map((category) => {
              const count = payload.summary.categoryCounts[category] ?? 0;
              if (!count) return null;
              return (
                <button key={category} className={filter === category ? "active" : ""} onClick={() => setFilter(category)}>
                  {categoryLabel[category]} <span>{count}</span>
                </button>
              );
            })}
          </div>

          <div className="checker-variance-list">
            {visibleRows.length === 0 ? (
              <div className="checker-variance-empty">
                <BadgeCheck size={18} />
                <div><strong>No changes in this filter.</strong><span>Choose another filter or review the approval evidence below.</span></div>
              </div>
            ) : visibleRows.map((row) => {
              const open = expanded.has(row.employeeId);
              const deltaPositive = Number(row.netDelta ?? 0) >= 0;
              return (
                <div className="checker-variance-row" key={row.employeeId}>
                  <button className="checker-variance-row-main" type="button" onClick={() => toggle(row.employeeId)} aria-expanded={open}>
                    <span className="checker-variance-expand">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
                    <span className="checker-variance-person">
                      <strong>{row.employeeName}</strong>
                      <small>{row.employeeNo} · {row.entryStatus}</small>
                    </span>
                    <span className="checker-variance-tags">
                      {row.categories.filter((category) => category !== "net_variance").slice(0, 4).map((category) => (
                        <span key={category} data-category={category}>{categoryLabel[category]}</span>
                      ))}
                    </span>
                    <span className="checker-variance-net">
                      <strong className={row.netDelta != null && row.netDelta < 0 ? "red-number" : "green-number"}>
                        {row.netDelta == null ? "New" : `${deltaPositive ? "+" : ""}${money(row.netDelta)}`}
                      </strong>
                      <small>{row.netPercent == null ? "no prior comparison" : `${row.netPercent > 0 ? "+" : ""}${row.netPercent.toFixed(1)}% net`}</small>
                    </span>
                  </button>

                  {open && (
                    <div className="checker-variance-details">
                      {row.payRevision && (
                        <div className="checker-variance-callout">
                          <RefreshCcw size={14} />
                          <div>
                            <strong>Effective pay change · {row.payRevision.effectiveDate}</strong>
                            <span>
                              {row.payRevision.previousPayBasis} {money(Number(row.payRevision.previousRateAmount))} → {row.payRevision.newPayBasis} {money(Number(row.payRevision.newRateAmount))}
                              {row.payRevision.reason ? ` · ${row.payRevision.reason}` : ""}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="checker-variance-line-grid">
                        {row.changedLines.map((line) => {
                          const positive = Number(line.netEffectDelta ?? 0) >= 0;
                          return (
                            <div key={`${line.code}-${line.label}`} className="checker-variance-line">
                              <span className="checker-variance-line-icon">
                                {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                              </span>
                              <div>
                                <strong>{line.label}</strong>
                                <small>{line.reason}</small>
                              </div>
                              <div>
                                <strong className={positive ? "green-number" : "red-number"}>
                                  {(line.netEffectDelta ?? 0) > 0 ? "+" : ""}{money(line.netEffectDelta ?? 0)}
                                </strong>
                                <small>{line.previous == null ? "No prior value" : `${money(line.previous)} → ${money(line.current)}`}</small>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="checker-variance-decision">
            <div>
              <History size={15} />
              <span>
                <strong>Decision is audited.</strong> Returning the payroll moves it back to Needs review. Approval still runs server-side payroll assurance before it can become Ready for release.
              </span>
            </div>
            {payrollTask && payrollTask.status === "Pending" && canDecide ? (
              <div className="checker-variance-actions">
                <button className="decline-button" disabled={busy} onClick={() => onDecide(payrollTask.id, "Declined")}>
                  Return to Payroll Officer
                </button>
                <button
                  className="primary-button brand"
                  disabled={busy || !payload.summary.coverageComplete}
                  onClick={() => onDecide(payrollTask.id, "Approved")}
                  title={!payload.summary.coverageComplete ? "Payroll calculation is incomplete." : undefined}
                >
                  {busy ? <Spinner label="Saving" /> : <BadgeCheck size={14} />} Approve payroll
                </button>
              </div>
            ) : (
              <div className="checker-variance-readonly">
                <CircleDollarSign size={14} />
                <span>{payrollTask ? `Decision: ${payrollTask.status}` : "No pending payroll decision is assigned."}</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

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
import { readVerifiedPayrollCheckerVariance, type VerifiedVariancePayload } from "@/lib/payroll-checker-variance-read";
import type { PayrollVarianceCategory } from "@/lib/payroll-variance";
import {
  selectPayrollVarianceRows,
  type PayrollVarianceMateriality, type PayrollVarianceSort,
} from "@/lib/payroll-variance-explorer";

type Category = PayrollVarianceCategory;
type VariancePayload = VerifiedVariancePayload;

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

type CheckerVarianceProps = {
  organizationId: number;
  run: PayrollRun;
  payrollTask: Task | null;
  busy: boolean;
  canDecide: boolean;
  onDecide: (id: number, status: "Approved" | "Declined") => Promise<void>;
};

export function CheckerVarianceCenter(props: CheckerVarianceProps) {
  // Switching the selected run must discard its prior employee details,
  // filters and fetched variance before the new run can paint.
  return <CheckerVarianceContent key={[props.organizationId, props.run.id, props.run.legalEntityId ?? "none"].join(":")} {...props} />;
}

function CheckerVarianceContent({
  organizationId,
  run,
  payrollTask,
  busy,
  canDecide,
  onDecide,
}: CheckerVarianceProps) {
  const [observation, setObservation] = useState<{
    scopeKey: string; payload: VariancePayload | null; error: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const scopeKey = JSON.stringify({
    organizationId, runId: run.id, legalEntityId: run.legalEntityId ?? null,
    scopeOrgUnitId: run.scopeOrgUnitId ?? null,
    periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate,
    periodLabel: run.periodLabel, status: run.status, ruleVersion: run.ruleVersion,
    employeeCount: run.employeeCount, grossPay: run.grossPay, netPay: run.netPay, revision,
  });
  const current = observation?.scopeKey === scopeKey ? observation : null;
  const payload = current?.payload ?? null;
  const error = current?.error ?? "";
  const loading = current === null;
  const [filter, setFilter] = useState<Category | "all">("all");
  const [materiality, setMateriality] = useState<PayrollVarianceMateriality>("all");
  const [sort, setSort] = useState<PayrollVarianceSort>("source");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    // Defer the first request until after the effect commits.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void readVerifiedPayrollCheckerVariance(organizationId, run, fetch, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setObservation({ scopeKey, payload: result, error: "" });
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setObservation({
            scopeKey, payload: null,
            error: cause instanceof Error ? cause.message : "Could not verify payroll variance.",
          });
        });
    });
    return () => controller.abort();
  }, [organizationId, run, scopeKey]);

  const visibleRows = useMemo(
    () => payload ? selectPayrollVarianceRows(payload.rows, filter, materiality, sort) : [],
    [payload, filter, materiality, sort],
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
          <span>{error} <button type="button" className="secondary-button" onClick={() => setRevision((value) => value + 1)}>Retry payroll variance</button></span>
        </div>
      )}

      {loading && (
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

          <div className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              Absolute net change
              <select value={materiality}
                onChange={(event) => setMateriality(event.target.value as PayrollVarianceMateriality)}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                <option value="all">All stored changes</option>
                <option value="at_least_100">At least ₱100</option>
                <option value="at_least_1000">At least ₱1,000</option>
                <option value="no_prior">No prior comparison</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              Display order
              <select value={sort} onChange={(event) => setSort(event.target.value as PayrollVarianceSort)}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                <option value="source">Source order</option>
                <option value="largest_net_change">Largest net change</option>
                <option value="employee">Employee name</option>
              </select>
            </label>
            <p className="max-w-lg text-xs leading-5 text-slate-600">
              Showing {visibleRows.length} of {payload.rows.length} verified changed-employee rows.
              Thresholds apply only to comparable stored net deltas. No-prior entries have no calculated delta.
              This display never recalculates payroll or changes checker approval rules.
            </p>
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

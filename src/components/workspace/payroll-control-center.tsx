"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  FileCheck2,
  FileSpreadsheet,
  Search,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import {
  auditPayrollControl,
  explainPayrollEntry,
  parseParallelPayrollCsv,
  type ParallelPayrollRow,
  type PayrollControlIssue,
  type PayrollReadiness,
} from "@/lib/payroll-control";
import type { Employee, Notify, PayrollEntry, PayrollRun, Task } from "./types";
import { money, moneyExact } from "./ui";
import styles from "./payroll-control-center.module.css";

export type PayrollControlSummary = {
  blocked: boolean;
  reviewRequired: boolean;
  highCount: number;
  mediumCount: number;
  parallelRows: number;
};

export function PayrollControlCenter({
  run,
  entries,
  previousEntries,
  previousRun,
  employees,
  approvalTask,
  notify,
  onInspectEntry,
  onControlChange,
}: {
  run: PayrollRun;
  entries: PayrollEntry[];
  previousEntries: PayrollEntry[];
  previousRun?: PayrollRun;
  employees: Employee[];
  approvalTask?: Task;
  notify: Notify;
  onInspectEntry: (entryId: number) => void;
  onControlChange?: (summary: PayrollControlSummary) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parallelRows, setParallelRows] = useState<ParallelPayrollRow[]>([]);
  const [parallelName, setParallelName] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [issueFilter, setIssueFilter] = useState<"all" | "high" | "medium">("all");

  const audit = useMemo(
    () =>
      auditPayrollControl({
        entries,
        employees,
        previousEntries,
        parallelRows,
        approvalTask,
      }),
    [entries, employees, previousEntries, parallelRows, approvalTask],
  );

  useEffect(() => {
    onControlChange?.({
      blocked: audit.readiness.verdict === "blocked",
      reviewRequired: audit.readiness.verdict === "review",
      highCount: audit.readiness.highCount,
      mediumCount: audit.readiness.mediumCount,
      parallelRows: parallelRows.length,
    });
  }, [audit.readiness, parallelRows.length, onControlChange]);

  const filteredIssues = audit.issues.filter((issue) => issueFilter === "all" || issue.severity === issueFilter);
  const previousByEmployee = useMemo(
    () => new Map(previousEntries.map((entry) => [entry.employeeId, entry])),
    [previousEntries],
  );

  const selectedEntry = entries.find((entry) => entry.employeeId === selectedEmployeeId);
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId);
  const selectedPrevious = selectedEmployeeId === null ? undefined : previousByEmployee.get(selectedEmployeeId);
  const selectedParallel =
    selectedEmployee && parallelRows.length
      ? parallelRows.find((row) => {
          const byNo = row.employeeNo && row.employeeNo.trim().toLowerCase() === selectedEmployee.employeeNo.trim().toLowerCase();
          if (byNo) return true;
          const name = row.name?.trim().toLowerCase();
          return name === `${selectedEmployee.firstName} ${selectedEmployee.lastName}`.trim().toLowerCase();
        })
      : undefined;

  const explanation = selectedEntry
    ? explainPayrollEntry({
        entry: selectedEntry,
        employee: selectedEmployee,
        previousEntry: selectedPrevious,
        parallelRow: selectedParallel,
      })
    : null;

  async function importParallel(file: File) {
    try {
      const text = await file.text();
      const parsed = parseParallelPayrollCsv(text);
      if (!parsed.rows.length) {
        notify(parsed.errors[0] ?? "No usable payroll rows were found in that CSV.", "err");
        return;
      }
      setParallelRows(parsed.rows);
      setParallelName(file.name);
      const suffix = parsed.errors.length
        ? ` ${parsed.errors.length} row${parsed.errors.length === 1 ? "" : "s"} were skipped.`
        : "";
      notify(`Parallel Payroll loaded ${parsed.rows.length} reference row${parsed.rows.length === 1 ? "" : "s"}.${suffix}`, "ok");
    } catch {
      notify("The payroll reference CSV could not be read.", "err");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function openIssue(issue: PayrollControlIssue) {
    if (!issue.employeeId) return;
    setSelectedEmployeeId(issue.employeeId);
  }

  const topVariances = audit.variances
    .filter((row) => row.previousDelta !== null || row.referenceDelta !== null)
    .sort((a, b) => {
      const aDelta = Math.max(Math.abs(a.referenceDelta ?? 0), Math.abs(a.previousDelta ?? 0));
      const bDelta = Math.max(Math.abs(b.referenceDelta ?? 0), Math.abs(b.previousDelta ?? 0));
      return bDelta - aDelta;
    })
    .slice(0, 6);

  return (
    <section className={styles.controlCenter} aria-label="Payroll Control Center">
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Payroll Control Center</span>
          <h3>Know what changed before you release.</h3>
          <p>
            Linaw audits the calculated register, compares it with the previous payroll, and can independently compare a
            CSV from your current payroll system.
          </p>
        </div>
        <ReadinessBadge readiness={audit.readiness} />
      </div>

      <div className={styles.metrics}>
        <Metric label="Employees" value={String(entries.length)} detail={run.periodLabel} />
        <Metric label="Net payroll" value={money(run.netPay)} detail="calculated by Linaw" />
        <Metric
          label="Needs attention"
          value={String(audit.readiness.highCount + audit.readiness.mediumCount)}
          detail={audit.readiness.highCount ? `${audit.readiness.highCount} blocking` : "no blocking issues"}
          tone={audit.readiness.highCount ? "danger" : audit.readiness.mediumCount ? "review" : "good"}
        />
        <Metric
          label="Parallel Payroll"
          value={parallelRows.length ? String(parallelRows.length) : "Optional"}
          detail={parallelRows.length ? parallelName || "reference loaded" : "compare another payroll"}
          tone={parallelRows.length ? "good" : undefined}
        />
      </div>

      <div className={styles.readiness}>
        <div className={styles.sectionTitle}>
          <div>
            <span>Release readiness</span>
            <strong>{audit.readiness.label}</strong>
          </div>
          <small>Every check is derived from this payroll run.</small>
        </div>
        <div className={styles.checkGrid}>
          {audit.readiness.checks.map((check) => (
            <article className={styles.check} data-state={check.state} key={check.key}>
              <span className={styles.checkIcon} aria-hidden>
                {check.state === "pass" ? (
                  <Check size={14} />
                ) : check.state === "blocked" ? (
                  <CircleAlert size={14} />
                ) : check.state === "review" ? (
                  <AlertTriangle size={14} />
                ) : (
                  <FileCheck2 size={14} />
                )}
              </span>
              <div>
                <strong>{check.label}</strong>
                <p>{check.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <span>Payroll auditor</span>
              <strong>
                {audit.issues.length
                  ? `${audit.issues.length} item${audit.issues.length === 1 ? "" : "s"} to review`
                  : "No configured checks triggered"}
              </strong>
            </div>
            <div className={styles.filters}>
              {(["all", "high", "medium"] as const).map((filter) => (
                <button
                  type="button"
                  className={issueFilter === filter ? styles.filterActive : undefined}
                  onClick={() => setIssueFilter(filter)}
                  key={filter}
                >
                  {filter === "all" ? "All" : filter === "high" ? "Blocking" : "Review"}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.issueList}>
            {!filteredIssues.length && (
              <div className={styles.empty}>
                <ShieldCheck size={18} />
                <strong>Nothing in this filter needs attention.</strong>
              </div>
            )}
            {filteredIssues.slice(0, 8).map((issue) => (
              <button
                type="button"
                className={styles.issue}
                data-severity={issue.severity}
                onClick={() => openIssue(issue)}
                disabled={!issue.employeeId}
                key={issue.id}
              >
                <span className={styles.issueIcon} aria-hidden>
                  {issue.severity === "high" ? <CircleAlert size={15} /> : <AlertTriangle size={15} />}
                </span>
                <span>
                  <strong>{issue.employeeName ? `${issue.employeeName}: ${issue.title}` : issue.title}</strong>
                  <small>{issue.detail}</small>
                </span>
                {issue.employeeId && <span className={styles.reviewLink}>Explain</span>}
              </button>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <span>Variance review</span>
              <strong>{previousRun ? `Compared with ${previousRun.periodLabel}` : "Previous payroll comparison"}</strong>
            </div>
          </div>

          {topVariances.length ? (
            <div className={styles.varianceList}>
              {topVariances.map((row) => {
                const delta = row.referenceDelta ?? row.previousDelta;
                const label = row.referenceDelta !== null ? "vs imported" : "vs previous";
                return (
                  <button
                    type="button"
                    className={styles.varianceRow}
                    onClick={() => setSelectedEmployeeId(row.employeeId)}
                    key={row.employeeId}
                  >
                    <span>
                      <strong>{row.employeeName}</strong>
                      <small>{row.employeeNo} · {label}</small>
                    </span>
                    <span className={styles.netValue}>{money(row.currentNet)}</span>
                    <span className={delta !== null && delta >= 0 ? styles.deltaUp : styles.deltaDown}>
                      {delta !== null && delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                      {delta === null ? "—" : money(Math.abs(delta))}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              <Search size={18} />
              <strong>No earlier or imported payroll is available to compare yet.</strong>
            </div>
          )}
        </article>
      </div>

      <article className={styles.parallel}>
        <div>
          <span className={styles.parallelIcon} aria-hidden>
            <FileSpreadsheet size={18} />
          </span>
          <div>
            <strong>Parallel Payroll</strong>
            <p>
              Export the payroll from your current system, then upload a CSV with <code>employee_no</code> and{" "}
              <code>net_pay</code>. Linaw compares every matched employee against its own calculation.
            </p>
          </div>
        </div>

        <div className={styles.parallelActions}>
          {parallelRows.length > 0 && (
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => {
                setParallelRows([]);
                setParallelName("");
                notify("Parallel Payroll reference cleared.", "info");
              }}
            >
              <X size={14} /> Clear
            </button>
          )}
          <button type="button" className={styles.uploadButton} onClick={() => fileRef.current?.click()}>
            <UploadCloud size={15} />
            {parallelRows.length ? "Replace CSV" : "Upload payroll CSV"}
          </button>
          <input
            ref={fileRef}
            className={styles.hiddenInput}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importParallel(file);
            }}
          />
        </div>
      </article>

      {explanation && (
        <div className={styles.explainOverlay} role="dialog" aria-modal="true" aria-label={`Explain pay for ${explanation.employeeName}`}>
          <button className={styles.scrim} type="button" onClick={() => setSelectedEmployeeId(null)} aria-label="Close explanation" />
          <aside className={styles.explainPanel}>
            <div className={styles.explainHead}>
              <div>
                <span className={styles.kicker}>Explain this pay</span>
                <h4>{explanation.employeeName}</h4>
                <p>{explanation.employeeNo} · {run.periodLabel}</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={() => setSelectedEmployeeId(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className={styles.explainTotals}>
              <div>
                <span>Gross</span>
                <strong>{moneyExact(explanation.grossPay)}</strong>
              </div>
              <div>
                <span>Deductions</span>
                <strong>−{moneyExact(explanation.deductions)}</strong>
              </div>
              <div>
                <span>Net pay</span>
                <strong>{moneyExact(explanation.netPay)}</strong>
              </div>
            </div>

            {(explanation.previousNet !== null || explanation.referenceNet !== null) && (
              <div className={styles.compareCards}>
                {explanation.previousNet !== null && (
                  <div>
                    <span>Previous cutoff</span>
                    <strong>{moneyExact(explanation.previousNet)}</strong>
                    <small>
                      {explanation.previousDelta !== null && explanation.previousDelta >= 0 ? "+" : "−"}
                      {explanation.previousDelta === null ? "0.00" : moneyExact(Math.abs(explanation.previousDelta))}
                    </small>
                  </div>
                )}
                {explanation.referenceNet !== null && (
                  <div>
                    <span>Imported payroll</span>
                    <strong>{moneyExact(explanation.referenceNet)}</strong>
                    <small>
                      Linaw {explanation.referenceDelta !== null && explanation.referenceDelta >= 0 ? "+" : "−"}
                      {explanation.referenceDelta === null ? "0.00" : moneyExact(Math.abs(explanation.referenceDelta))}
                    </small>
                  </div>
                )}
              </div>
            )}

            <div className={styles.explainSection}>
              <div className={styles.explainSectionHead}>
                <strong>What changed</strong>
                <span>largest changes first</span>
              </div>
              {explanation.changes.length ? (
                explanation.changes.slice(0, 8).map((change) => (
                  <div className={styles.changeRow} key={change.code}>
                    <span>
                      <code>{change.code}</code>
                      {change.label}
                    </span>
                    <strong className={change.delta >= 0 ? styles.deltaUpText : styles.deltaDownText}>
                      {change.delta >= 0 ? "+" : "−"}{moneyExact(Math.abs(change.delta))}
                    </strong>
                  </div>
                ))
              ) : (
                <p className={styles.mutedCopy}>No prior line-item changes are available for this employee.</p>
              )}
            </div>

            <div className={styles.explainSection}>
              <div className={styles.explainSectionHead}>
                <strong>Current calculation</strong>
                <span>stored payroll line items</span>
              </div>
              {explanation.lineItems.map((line) => (
                <div className={styles.changeRow} key={`${line.code}-${line.label}`}>
                  <span>
                    <code>{line.code}</code>
                    {line.label}
                  </span>
                  <strong>{line.amount >= 0 ? "" : "−"}{moneyExact(Math.abs(line.amount))}</strong>
                </div>
              ))}
            </div>

            {explanation.flags.length > 0 && (
              <div className={styles.flagBox}>
                <AlertTriangle size={15} />
                <div>
                  <strong>Engine flags</strong>
                  {explanation.flags.map((flag) => <p key={flag}>{flag}</p>)}
                </div>
              </div>
            )}

            <button
              type="button"
              className={styles.inspectButton}
              onClick={() => {
                onInspectEntry(selectedEntry!.id);
                setSelectedEmployeeId(null);
              }}
            >
              Open full payslip trace
            </button>
          </aside>
        </div>
      )}
    </section>
  );
}

function ReadinessBadge({ readiness }: { readiness: PayrollReadiness }) {
  return (
    <span className={styles.readinessBadge} data-verdict={readiness.verdict}>
      <span aria-hidden />
      {readiness.label}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "review" | "danger";
}) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

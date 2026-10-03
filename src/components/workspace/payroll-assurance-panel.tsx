"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  FileSearch,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import type { Employee } from "@/components/workspace/types";
import type { AssuranceFinding, EmployeeVariance } from "@/lib/payroll-assurance";
import {
  buildParallelPayrollComparison,
  parallelComponentLabel,
  type ParallelComponentKey,
  type ParallelPayrollRow,
} from "@/lib/parallel-payroll";
import { money } from "@/components/workspace/ui";

type AssurancePayload = {
  runId: number;
  previousRun: {
    id: number;
    periodLabel: string;
    payDate: string;
    netPay: string;
    grossPay: string;
  } | null;
  findings: AssuranceFinding[];
  comparisons: EmployeeVariance[];
  summary: {
    high: number;
    medium: number;
    info: number;
    blocking: number;
    materialChanges: number;
    comparedEmployees: number;
  };
};

export function PayrollAssurancePanel({
  runId,
  employees,
  onExplainEmployee,
}: {
  runId: number;
  employees: Employee[];
  onExplainEmployee?: (employeeId: number) => void;
}) {
  const [payload, setPayload] = useState<AssurancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expandedEmployee, setExpandedEmployee] = useState<number | null>(null);
  const [parallelOpen, setParallelOpen] = useState(false);
  const [parallelRows, setParallelRows] = useState<ParallelPayrollRow[]>([]);
  const [parallelDetected, setParallelDetected] = useState<ParallelComponentKey[]>([]);
  const [parallelUnmatched, setParallelUnmatched] = useState<string[]>([]);
  const [parallelSkipped, setParallelSkipped] = useState(0);
  const [parallelExpandedEmployee, setParallelExpandedEmployee] = useState<number | null>(null);
  const [parallelError, setParallelError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    setPayload(null);
    setExpandedEmployee(null);
    setParallelRows([]);
    setParallelDetected([]);
    setParallelUnmatched([]);
    setParallelSkipped(0);
    setParallelExpandedEmployee(null);
    setParallelError("");

    void fetch(`/api/payroll-runs/${runId}/assurance`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("assurance failed");
        return response.json() as Promise<AssurancePayload>;
      })
      .then((data) => {
        if (!alive) return;
        setPayload(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [runId]);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const material = payload?.comparisons.filter((comparison) => comparison.hasMaterialChange) ?? [];
  const blocking = payload?.findings.filter((finding) => finding.blocking) ?? [];
  const reviewFindings = payload?.findings.filter((finding) => !finding.blocking && finding.severity !== "info") ?? [];

  async function loadParallelFile(file: File) {
    setParallelError("");
    setParallelRows([]);
    setParallelDetected([]);
    setParallelUnmatched([]);
    setParallelSkipped(0);
    setParallelExpandedEmployee(null);

    try {
      const text = await file.text();
      const records = parseCsv(text);
      if (records.length === 0) {
        setParallelError("No payroll rows were found in that CSV.");
        return;
      }

      const result = buildParallelPayrollComparison({
        records,
        employees,
        comparisons: payload?.comparisons ?? [],
      });

      if (result.rows.length === 0) {
        setParallelError(
          result.unmatchedEmployeeNumbers.length > 0
            ? "Employee numbers were found, but none matched employees in this payroll run."
            : "No comparable payroll amounts were found for matched employees.",
        );
        setParallelUnmatched(result.unmatchedEmployeeNumbers);
        setParallelSkipped(result.skippedRows);
        return;
      }

      setParallelRows(result.rows);
      setParallelDetected(result.detected);
      setParallelUnmatched(result.unmatchedEmployeeNumbers);
      setParallelSkipped(result.skippedRows);
    } catch (error) {
      setParallelError(error instanceof Error ? error.message : "Could not read that CSV.");
    }
  }

  if (loading) {
    return (
      <div className="card-body" style={{ borderTop: "1px solid var(--line-faint)" }}>
        <div className="card-kicker">Payroll assurance</div>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>Checking this run against payroll controls and the previous cutoff…</p>
      </div>
    );
  }

  if (failed || !payload) {
    return (
      <div className="card-body" style={{ borderTop: "1px solid var(--line-faint)" }}>
        <div className="notice notice-amber" style={{ margin: 0 }}>
          <AlertTriangle size={15} className="i-amber" />
          <span>Payroll assurance could not be loaded. The payroll register remains available.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card-body assurance-panel" style={{ paddingTop: 0 }}>
      <div className="line-title" style={{ margin: 0 }}>
        <div>
          <strong>Payroll assurance</strong>
          <span>
            {payload.previousRun
              ? `Compared with ${payload.previousRun.periodLabel}`
              : "First stored payroll, no previous cutoff yet"}
          </span>
        </div>
        <button className="secondary-button" onClick={() => setParallelOpen((current) => !current)} aria-expanded={parallelOpen}>
          <UploadCloud size={14} className="i-teal" /> Parallel payroll
        </button>
      </div>

      <div className="stats-grid" style={{ marginTop: 14 }}>
        <AssuranceMetric
          label="Release blockers"
          value={String(payload.summary.blocking)}
          detail={payload.summary.blocking ? "must be fixed before release" : "no hard integrity failures"}
          tone={payload.summary.blocking ? "danger" : "success"}
        />
        <AssuranceMetric
          label="Needs review"
          value={String(payload.summary.medium)}
          detail="exceptions and unusual payroll movements"
          tone={payload.summary.medium ? "review" : "success"}
        />
        <AssuranceMetric
          label="Material changes"
          value={String(payload.summary.materialChanges)}
          detail={payload.previousRun ? "vs previous payroll" : "comparison starts next cutoff"}
          tone={payload.summary.materialChanges ? "review" : "active"}
        />
        <AssuranceMetric
          label="Compared"
          value={String(payload.summary.comparedEmployees)}
          detail="employees with a previous-run match"
          tone="active"
        />
      </div>

      {blocking.length > 0 ? (
        <div className="notice notice-red" style={{ marginTop: 14 }}>
          <ShieldCheck size={15} className="i-red" />
          <span>
            <strong>Release blocked.</strong> {blocking.length} payroll-integrity issue{blocking.length === 1 ? "" : "s"} must be resolved first.
          </span>
        </div>
      ) : (
        <div className="notice notice-green" style={{ marginTop: 14 }}>
          <Check size={15} className="i-green" />
          <span>
            <strong>No hard payroll-integrity blockers.</strong> Review exceptions and material changes before approval or release.
          </span>
        </div>
      )}

      {(blocking.length > 0 || reviewFindings.length > 0) && (
        <div style={{ marginTop: 14 }}>
          {[...blocking, ...reviewFindings].slice(0, 6).map((finding, index) => {
            const employee = finding.employeeId ? employeeById.get(finding.employeeId) : null;
            return (
              <div className="exception-row" key={`${finding.code}-${finding.employeeId ?? "run"}-${index}`}>
                <AlertTriangle
                  size={15}
                  style={{
                    flex: "none",
                    marginTop: 1,
                    color: finding.blocking ? "var(--danger)" : "var(--review)",
                  }}
                />
                <div>
                  <strong>
                    {finding.title}
                    {employee ? <span style={{ fontWeight: 500, color: "var(--muted)" }}> · {employee.firstName} {employee.lastName}</span> : null}
                  </strong>
                  <p>{finding.detail}</p>
                </div>
                {finding.employeeId && onExplainEmployee && (
                  <button className="secondary-button" onClick={() => onExplainEmployee(finding.employeeId!)}>
                    <FileSearch size={13} /> Explain pay
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {material.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="line-title" style={{ margin: 0 }}>
            <strong>Explain the change</strong>
            <span>Largest net-pay movements from the previous cutoff</span>
          </div>

          <div className="audit-list">
            {material.slice(0, 8).map((comparison) => {
              const employee = employeeById.get(comparison.employeeId);
              const open = expandedEmployee === comparison.employeeId;
              return (
                <div key={comparison.employeeId}>
                  <button
                    className="audit-row"
                    style={{ width: "100%", border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}
                    onClick={() => setExpandedEmployee(open ? null : comparison.employeeId)}
                    aria-expanded={open}
                  >
                    <span className="audit-dot"><FileSearch size={14} className="i-purple" /></span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${comparison.employeeId}`}</strong>
                      <p>
                        {money(comparison.previousNet ?? 0)} → {money(comparison.currentNet)} ·{" "}
                        <span className={comparison.netDelta && comparison.netDelta > 0 ? "green-number" : "red-number"}>
                          {comparison.netDelta && comparison.netDelta > 0 ? "+" : ""}{money(comparison.netDelta ?? 0)}
                        </span>
                      </p>
                    </div>
                    <span className="status status-review">
                      {comparison.netPercent == null ? "new baseline" : `${comparison.netPercent > 0 ? "+" : ""}${comparison.netPercent.toFixed(1)}%`}
                    </span>
                    <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined }} />
                  </button>

                  {open && (
                    <div className="trace-box" style={{ margin: "0 18px 14px" }}>
                      <p>What changed in the payslip</p>
                      {comparison.lineChanges.slice(0, 8).map((line) => (
                        <span className="trace-line" key={line.code} style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                          <span>
                            <span className="k">{line.label}</span>
                            <small style={{ display: "block", color: "var(--muted)" }}>
                              {money(line.previous)} → {money(line.current)}
                            </small>
                          </span>
                          <strong className={line.delta >= 0 ? "green-number" : "red-number"}>
                            {line.delta >= 0 ? "+" : ""}{money(line.delta)}
                          </strong>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {parallelOpen && (
        <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">Parallel payroll</div>
              <h2 style={{ fontSize: 16 }}>Reconcile your existing payroll against Linaw</h2>
              <p>
                Compare gross pay, SSS, PhilHealth, Pag-IBIG, withholding tax, other deductions, and net pay employee by employee.
                The file stays in this browser and never changes the payroll run.
              </p>
            </div>
            <button className="icon-button" onClick={() => setParallelOpen(false)} aria-label="Close parallel payroll">
              <X size={15} />
            </button>
          </div>

          <div className="card-body" style={{ paddingTop: 0 }}>
            <label className="parallel-upload" style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, border: "1px dashed var(--line)", borderRadius: 10, cursor: "pointer" }}>
              <UploadCloud size={18} className="i-teal" />
              <span style={{ display: "grid", gap: 3 }}>
                <strong style={{ fontSize: 12 }}>Upload existing payroll CSV</strong>
                <small style={{ color: "var(--muted)", lineHeight: 1.5 }}>
                  Use employee_no plus any of: gross_pay, sss, philhealth, pagibig, withholding_tax, other_deductions, total_deductions, net_pay.
                </small>
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadParallelFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>

            {parallelError && (
              <div className="notice notice-amber" style={{ marginTop: 12 }}>
                <AlertTriangle size={14} className="i-amber" />
                <span>{parallelError}</span>
              </div>
            )}

            {parallelRows.length > 0 && (
              <>
                <div className="stats-grid" style={{ marginTop: 14 }}>
                  <AssuranceMetric
                    label="Matched"
                    value={String(parallelRows.length)}
                    detail="employees reconciled"
                    tone="active"
                  />
                  <AssuranceMetric
                    label="Differences"
                    value={String(parallelRows.filter((row) => row.differenceCount > 0).length)}
                    detail="employees with ≥ ₱1 variance"
                    tone={parallelRows.some((row) => row.differenceCount > 0) ? "review" : "success"}
                  />
                  <AssuranceMetric
                    label="Components"
                    value={String(parallelDetected.length)}
                    detail="payroll fields detected"
                    tone="active"
                  />
                  <AssuranceMetric
                    label="Unmatched"
                    value={String(parallelUnmatched.length + parallelSkipped)}
                    detail="rows not reconciled"
                    tone={parallelUnmatched.length + parallelSkipped > 0 ? "review" : "success"}
                  />
                </div>

                <div className="line-title" style={{ marginTop: 16 }}>
                  <div>
                    <strong>Component coverage</strong>
                    <span>{parallelDetected.map(parallelComponentLabel).join(" · ")}</span>
                  </div>
                  <span>Click an employee to explain each difference</span>
                </div>

                {(parallelUnmatched.length > 0 || parallelSkipped > 0) && (
                  <div className="notice notice-amber" style={{ marginTop: 10 }}>
                    <AlertTriangle size={14} className="i-amber" />
                    <span>
                      {parallelUnmatched.length > 0
                        ? `${parallelUnmatched.length} employee number(s) did not match this run`
                        : ""}
                      {parallelUnmatched.length > 0 && parallelSkipped > 0 ? " · " : ""}
                      {parallelSkipped > 0 ? `${parallelSkipped} row(s) had no comparable amount` : ""}
                    </span>
                  </div>
                )}

                <div className="audit-list" style={{ marginTop: 8 }}>
                  {parallelRows.slice(0, 50).map((row) => {
                    const open = parallelExpandedEmployee === row.employeeId;
                    const net = row.components.find((component) => component.key === "net");
                    const largest = [...row.components].sort(
                      (a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0),
                    )[0];

                    return (
                      <div key={row.employeeId}>
                        <button
                          className="audit-row"
                          style={{ width: "100%", border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}
                          onClick={() => setParallelExpandedEmployee(open ? null : row.employeeId)}
                          aria-expanded={open}
                        >
                          <span className="audit-dot"><FileSearch size={14} className="i-purple" /></span>
                          <div style={{ minWidth: 0 }}>
                            <strong>{row.name}</strong>
                            <p>
                              {row.employeeNo} ·{" "}
                              {row.differenceCount === 0
                                ? "all compared components match"
                                : `${row.differenceCount} component difference${row.differenceCount === 1 ? "" : "s"}`}
                            </p>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <strong className={row.differenceCount === 0 ? "green-number" : "red-number"}>
                              {net?.delta != null
                                ? `${net.delta > 0 ? "+" : ""}${money(net.delta)} net`
                                : largest?.delta != null
                                  ? `${largest.delta > 0 ? "+" : ""}${money(largest.delta)}`
                                  : "Matched"}
                            </strong>
                            <small style={{ display: "block", marginTop: 2, color: "var(--muted)" }}>
                              {net?.percent == null ? largest?.label ?? "No variance" : `${net.percent > 0 ? "+" : ""}${net.percent.toFixed(1)}%`}
                            </small>
                          </div>
                          <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined }} />
                        </button>

                        {open && (
                          <div className="trace-box" style={{ margin: "0 18px 14px" }}>
                            <p>Existing payroll → Linaw</p>
                            {row.components.map((component) => (
                              <span
                                className="trace-line"
                                key={component.key}
                                style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) auto auto", gap: 14, alignItems: "center" }}
                              >
                                <span>
                                  <span className="k">{component.label}</span>
                                  <small style={{ display: "block", color: "var(--muted)" }}>
                                    {money(component.existing ?? 0)} → {money(component.linaw)}
                                  </small>
                                </span>
                                <strong className={component.different ? "red-number" : "green-number"}>
                                  {component.delta != null && component.delta > 0 ? "+" : ""}
                                  {money(component.delta ?? 0)}
                                </strong>
                                <small style={{ minWidth: 56, textAlign: "right", color: "var(--muted)" }}>
                                  {component.percent == null
                                    ? "—"
                                    : `${component.percent > 0 ? "+" : ""}${component.percent.toFixed(1)}%`}
                                </small>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <a href="#payroll-register" className="link-button" style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6 }}>
        Review the payroll register <ArrowRight size={13} />
      </a>
    </div>
  );
}

function AssuranceMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "danger" | "review" | "success" | "active";
}) {
  const className =
    tone === "danger"
      ? "red-number"
      : tone === "success"
        ? "green-number"
        : tone === "review"
          ? ""
          : "";

  return (
    <article className="stat-card" style={{ minHeight: 0 }}>
      <p>{label.toUpperCase()}</p>
      <h3 className={className}>{value}</h3>
      <span>{detail}</span>
    </article>
  );
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? ""])),
  );
}

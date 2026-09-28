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

type ParallelRow = {
  employeeId: number;
  employeeNo: string;
  name: string;
  existingNet: number;
  linawNet: number;
  delta: number;
  percent: number | null;
};

export function PayrollAssurancePanel({
  runId,
  employees,
}: {
  runId: number;
  employees: Employee[];
}) {
  const [payload, setPayload] = useState<AssurancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expandedEmployee, setExpandedEmployee] = useState<number | null>(null);
  const [parallelOpen, setParallelOpen] = useState(false);
  const [parallelRows, setParallelRows] = useState<ParallelRow[]>([]);
  const [parallelError, setParallelError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    setPayload(null);
    setExpandedEmployee(null);
    setParallelRows([]);
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

    try {
      const text = await file.text();
      const records = parseCsv(text);
      if (records.length === 0) {
        setParallelError("No payroll rows were found in that CSV.");
        return;
      }

      const employeeColumn = findColumn(Object.keys(records[0]), [
        "employee_no",
        "employee_number",
        "employee id",
        "employee_id",
        "employee",
      ]);
      const netColumn = findColumn(Object.keys(records[0]), [
        "existing_net_pay",
        "existing net pay",
        "net_pay",
        "net pay",
        "net",
      ]);

      if (!employeeColumn || !netColumn) {
        setParallelError("CSV needs an employee number column and a net pay column.");
        return;
      }

      const byEmployeeNo = new Map(employees.map((employee) => [employee.employeeNo.trim().toLowerCase(), employee]));
      const currentByEmployee = new Map((payload?.comparisons ?? []).map((comparison) => [comparison.employeeId, comparison]));
      const next: ParallelRow[] = [];

      for (const record of records) {
        const employeeNo = String(record[employeeColumn] ?? "").trim();
        const employee = byEmployeeNo.get(employeeNo.toLowerCase());
        if (!employee) continue;
        const comparison = currentByEmployee.get(employee.id);
        if (!comparison) continue;

        const existingNet = parseMoney(record[netColumn]);
        if (existingNet == null) continue;
        const delta = round(comparison.currentNet - existingNet);
        const percent = existingNet === 0 ? null : round((delta / Math.abs(existingNet)) * 100);

        next.push({
          employeeId: employee.id,
          employeeNo: employee.employeeNo,
          name: `${employee.firstName} ${employee.lastName}`,
          existingNet,
          linawNet: comparison.currentNet,
          delta,
          percent,
        });
      }

      if (next.length === 0) {
        setParallelError("None of the employee numbers in the CSV matched this payroll run.");
        return;
      }

      next.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      setParallelRows(next);
    } catch {
      setParallelError("Could not read that CSV.");
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
              <h2 style={{ fontSize: 16 }}>Compare an existing payroll file with Linaw</h2>
              <p>
                Upload a CSV containing employee number and existing net pay. The comparison stays in this browser and does not change the payroll run.
              </p>
            </div>
            <button className="icon-button" onClick={() => setParallelOpen(false)} aria-label="Close parallel payroll">
              <X size={15} />
            </button>
          </div>

          <div className="card-body" style={{ paddingTop: 0 }}>
            <label className="parallel-upload" style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, border: "1px dashed var(--line)", borderRadius: 12, cursor: "pointer" }}>
              <UploadCloud size={18} className="i-teal" />
              <span style={{ display: "grid", gap: 2 }}>
                <strong style={{ fontSize: 12 }}>Upload existing payroll CSV</strong>
                <small style={{ color: "var(--muted)" }}>Columns: employee_no + existing_net_pay (net_pay also accepted)</small>
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
                <div className="line-title">
                  <strong>{parallelRows.length} matched employees</strong>
                  <span>{parallelRows.filter((row) => Math.abs(row.delta) >= 1).length} with a difference</span>
                </div>
                <div className="data-table-wrap slim-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th className="right">Existing net</th>
                        <th className="right">Linaw net</th>
                        <th className="right">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parallelRows.slice(0, 50).map((row) => (
                        <tr key={row.employeeId}>
                          <td>
                            <strong>{row.name}</strong>
                            <span className="id" style={{ display: "block" }}>{row.employeeNo}</span>
                          </td>
                          <td className="right num">{money(row.existingNet)}</td>
                          <td className="right num">{money(row.linawNet)}</td>
                          <td className="right num">
                            <strong className={Math.abs(row.delta) < 1 ? "green-number" : "red-number"}>
                              {row.delta > 0 ? "+" : ""}{money(row.delta)}
                            </strong>
                            <small style={{ display: "block", color: "var(--muted)" }}>
                              {row.percent == null ? "—" : `${row.percent > 0 ? "+" : ""}${row.percent.toFixed(1)}%`}
                            </small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

function findColumn(columns: string[], candidates: string[]) {
  const normalized = new Map(columns.map((column) => [normalizeHeader(column), column]));
  for (const candidate of candidates) {
    const found = normalized.get(normalizeHeader(candidate));
    if (found) return found;
  }
  return null;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseMoney(value: unknown) {
  const cleaned = String(value ?? "").replace(/[₱,$\s]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

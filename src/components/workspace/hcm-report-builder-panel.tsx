"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  currentReportPreview,
  reportPreviewKey,
  selectedAuthorizedReportFields,
} from "@/lib/hcm-report-builder-client";

type Field = { dataset: string; key: string; label: string; salary: boolean; groupable: boolean };
type Dataset = "people" | "time" | "payroll";
type Preview = { columns: string[]; rows: Array<Record<string, string | number>>; rowCount: number };
type PreviewReceipt = { key: string; result: Preview };

const defaults: Record<Dataset, string[]> = {
  people: ["department", "headcount", "turnover"],
  time: ["department", "absenceDays", "overtimeHours"],
  payroll: ["department", "grossPay", "overtimeCost"],
};
const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export function HcmReportBuilderPanel({ organizationId }: { organizationId: number }) {
  const [fieldsAvailable, setFieldsAvailable] = useState<Field[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [dataset, setDataset] = useState<Dataset>("people");
  const [fields, setFields] = useState<string[]>(defaults.people);
  const [groupBy, setGroupBy] = useState("department");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [startDate, setStartDate] = useState(() => today().slice(0, 8) + "01");
  const [endDate, setEndDate] = useState(today);
  const [previewReceipt, setPreviewReceipt] = useState<PreviewReceipt | null>(null);
  const [busy, setBusy] = useState<"json" | "csv" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);

  const loadCapabilities = useCallback(async (signal?: AbortSignal) => {
    // Initial effect starts only async network synchronization: no synchronous
    // setState call during commit. Retry state updates occur in the click handler.
    try {
      const response = await fetch("/api/hcm-report-builder?organizationId=" + organizationId,
        { cache: "no-store", signal });
      if (signal?.aborted) return;
      // A 404 is the default-off contract. Never flash a new card on the
      // legacy workspace while checking a disabled release-critical feature.
      if (response.status === 404) { setEnabled(false); return; }
      const payload = await response.json().catch(() => ({}));
      if (signal?.aborted) return;
      if (!response.ok) throw new Error(String(payload.error ?? "Report builder could not open."));
      if (!Array.isArray(payload.fields)) throw new Error("Report fields are unavailable.");
      setFieldsAvailable(payload.fields as Field[]);
      setEnabled(true);
    } catch (err) {
      if (!signal?.aborted) {
        setEnabled(true);
        setFieldsAvailable([]);
        setError(err instanceof Error ? err.message : "Report builder is unavailable.");
      }
    } finally {
      if (!signal?.aborted) setRetrieving(false);
    }
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCapabilities(controller.signal);
    return () => { controller.abort(); generation.current += 1; };
  }, [loadCapabilities]);

  const options = fieldsAvailable.filter((field) => field.dataset === dataset);
  const visibleFields = selectedAuthorizedReportFields(dataset, fields, fieldsAvailable);
  const queryKey = reportPreviewKey({ dataset, fields: visibleFields, groupBy: groupBy || null,
    departmentFilter, startDate, endDate });
  const preview = currentReportPreview(previewReceipt, queryKey);

  const invalidate = () => {
    generation.current += 1;
    setPreviewReceipt(null);
    setError("");
    setNotice("");
  };

  const execute = async (format: "csv" | "json") => {
    if (visibleFields.length === 0) { setError("Select at least one available field."); return; }
    if (format === "csv" && !preview) {
      setError("Preview the current selections before exporting the CSV."); return;
    }
    const requestGeneration = generation.current;
    const keyAtRequest = queryKey;
    const selectedDataset = dataset;
    setBusy(format);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/hcm-report-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, dataset, fields: visibleFields,
          groupBy: groupBy || null,
          filters: departmentFilter.trim() ? { department: departmentFilter.trim() } : {},
          startDate, endDate, format,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(String(payload.error ?? "Could not run the custom report."));
      }
      if (format === "json") {
        const result = await response.json() as Preview;
        if (requestGeneration === generation.current) {
          setPreviewReceipt({ key: keyAtRequest, result });
        }
      } else {
        const blob = await response.blob();
        // If filters/role context changed while the request was pending, never
        // download the prior employer/report selection as the current export.
        if (requestGeneration !== generation.current) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "linaw-" + selectedDataset + "-report.csv";
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setNotice("CSV export requested and recorded in the audit trail.");
      }
    } catch (err) {
      if (requestGeneration === generation.current) {
        setError(err instanceof Error ? err.message : "Report failed.");
      }
    } finally { setBusy(null); }
  };

  // The parent Analytics view still mounts this component when the feature is
  // disabled. Its 404 response must result in exactly zero visible UI.
  if (!enabled) return null;

  const formInputStyle = { width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" as const };
  const formLabelStyle = { display: "grid", gap: 5, minWidth: 0 };

  return (
    <article className="card" style={{ marginBottom: 16, minWidth: 0 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">Custom analytics</div>
          <h2>Report builder</h2>
          <p>Choose approved fields and preview results. Salary data is available only to authorized People and payroll roles.</p>
        </div>
      </div>
      <div style={{ padding: "0 18px 18px", display: "grid", gap: 12, minWidth: 0 }}>
        {error && <p role="alert" style={{ color: "var(--danger, #a22)" }}>{error}</p>}
        {retrieving && <p role="status">Loading available report fields…</p>}
        {error && fieldsAvailable.length === 0 && (
          <button type="button" className="secondary-button" disabled={retrieving}
            onClick={() => { setRetrieving(true); setError(""); void loadCapabilities(); }}
            style={{ justifySelf: "start" }}>
            Retry loading fields
          </button>
        )}
        {fieldsAvailable.length > 0 && (
          <>
            <div style={{ display: "grid", gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 176px), 1fr))" }}>
              <label style={formLabelStyle}>Dataset
                <select aria-label="Report dataset" value={dataset} style={formInputStyle} onChange={(event) => {
                  const next = event.target.value as Dataset;
                  invalidate(); setDataset(next); setFields(defaults[next]);
                  setGroupBy("department"); setDepartmentFilter("");
                }}>
                  <option value="people">People</option><option value="time">Time</option><option value="payroll">Payroll</option>
                </select>
              </label>
              <label style={formLabelStyle}>Start date
                <input aria-label="Report start date" type="date" value={startDate} style={formInputStyle}
                  onChange={(event) => { invalidate(); setStartDate(event.target.value); }} />
              </label>
              <label style={formLabelStyle}>End date
                <input aria-label="Report end date" type="date" value={endDate} style={formInputStyle}
                  onChange={(event) => { invalidate(); setEndDate(event.target.value); }} />
              </label>
              <label style={formLabelStyle}>Group by
                <select aria-label="Group report by" value={groupBy} style={formInputStyle}
                  onChange={(event) => { invalidate(); setGroupBy(event.target.value); }}>
                  <option value="">No grouping</option><option value="department">Department / payroll unit</option>
                  {dataset === "people" && <option value="status">Employment status</option>}
                </select>
              </label>
              <label style={formLabelStyle}>Department filter (exact)
                <input aria-label="Department filter" value={departmentFilter} style={formInputStyle}
                  onChange={(event) => { invalidate(); setDepartmentFilter(event.target.value); }}
                  placeholder="Optional" maxLength={120} />
              </label>
            </div>
            <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, minWidth: 0 }}>
              <legend>Select report fields</legend>
              {options.length === 0 ? <p>No fields are available for this dataset and role.</p> : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 15 }}>
                  {options.map((field) => (
                    <label key={field.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <input type="checkbox" checked={visibleFields.includes(field.key)}
                        onChange={(event) => {
                          invalidate();
                          setFields((current) => event.target.checked
                            ? [...new Set([...current, field.key])]
                            : current.filter((key) => key !== field.key));
                        }} />
                      {field.label}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="secondary-button" disabled={busy !== null || visibleFields.length === 0}
                onClick={() => void execute("json")}>
                {busy === "json" ? "Building preview…" : "Preview report"}
              </button>
              <button type="button" className="secondary-button" disabled={busy !== null || !preview}
                onClick={() => void execute("csv")}>
                {busy === "csv" ? "Exporting…" : "Export audited CSV"}
              </button>
            </div>
            {busy && <p role="status">{busy === "json" ? "Building report preview…" : "Preparing audited CSV export…"}</p>}
            {notice && <p role="status">{notice}</p>}
            {!preview && !busy && !error && <p role="status">Select fields and choose Preview report to see matching records.</p>}
            {preview && (
              <div className="data-table-wrap slim-scroll" style={{ minWidth: 0, overflowX: "auto" }}>
                {preview.rowCount === 0 ? <p role="status">No records match these report selections.</p> : (
                  <>
                    <p>{preview.rowCount} grouped result{preview.rowCount === 1 ? "" : "s"}</p>
                    <table className="data-table">
                      <thead><tr>{preview.columns.map((column) => (
                        <th key={column}>{options.find((field) => field.key === column)?.label ?? column}</th>
                      ))}</tr></thead>
                      <tbody>{preview.rows.map((row, index) => (
                        <tr key={index}>{preview.columns.map((column) => (
                          <td key={column}>{String(row[column] ?? "")}</td>
                        ))}</tr>
                      ))}</tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </>
        )}
        <p style={{ fontSize: 12, opacity: 0.8 }}>
          Historical turnover is not reassigned to a worker’s current department. Payroll department costs require released,
          unit-scoped payroll evidence; unattributed company-wide runs are blocked.
        </p>
      </div>
    </article>
  );
}

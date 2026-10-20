"use client";
import { useEffect, useRef, useState } from "react";
import {
  authorizedReportBuilderSelection, tenantReportPreviewKey,
  verifyReportBuilderCapabilities, verifyReportBuilderCsvResponse, verifyReportBuilderPreview,
  type ReportBuilderCapabilities, type ReportBuilderDataset,
} from "@/lib/tenant-report-builder-client";

const DEFAULT_FIELDS: Record<ReportBuilderDataset, string[]> = {
  people: ["department", "headcount"],
  time: ["department", "overtimeMinutes", "absenceDays"],
  payroll: ["department", "payrollCost"],
};
type Preview = { key: string; columns: string[]; rows: string[][] };

// Employer changes must create a new stateful view; otherwise an A→B→A
// switch can reuse a previously authorized preview with an identical key.
export function TenantReportBuilder({ organizationId }: { organizationId: number }) {
  return <ScopedTenantReportBuilder key={organizationId} organizationId={organizationId} />;
}

function ScopedTenantReportBuilder({ organizationId }: { organizationId: number }) {
  const [capabilities, setCapabilities] = useState<{ scope: string; value: ReportBuilderCapabilities } | null>(null);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [dataset, setDataset] = useState<ReportBuilderDataset>("people");
  const [fields, setFields] = useState<string[]>(DEFAULT_FIELDS.people);
  const [groupBy, setGroupBy] = useState("department");
  const [startDate, setStartDate] = useState("2026-10-01");
  const [endDate, setEndDate] = useState("2026-10-31");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<{ key: string; message: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const generation = useRef(0);
  const capabilityScope = organizationId + ":" + capabilityRetry;
  const capabilityErrorKey = "capabilities:" + capabilityScope;
  const verifiedCapabilities = capabilities?.scope === capabilityScope ? capabilities.value : null;
  const selected = authorizedReportBuilderSelection(
    organizationId, dataset, fields, groupBy, verifiedCapabilities,
  );
  const activeCapabilities = verifiedCapabilities?.fields ?? null;
  const key = tenantReportPreviewKey({
    organizationId, dataset, fields: selected.fields,
    groupBy: selected.groupBy, startDate, endDate,
  });
  const visiblePreview = activeCapabilities && preview?.key === key ? preview : null;
  const busy = busyKey === key;
  const error = notice?.key === key || notice?.key === capabilityErrorKey
    ? notice.message : "";
  const capabilityError = notice?.key === capabilityErrorKey;

  useEffect(() => {
    const controller = new AbortController();
    const scope = organizationId;
    const requestScope = capabilityScope;
    // Only the active employer AND load attempt may authorize report controls.
    void fetch("/api/reports/builder?organizationId=" + scope, {
      signal: controller.signal, cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw Error("This report builder is unavailable for your role.");
      const body: unknown = await response.json();
      const verified = verifyReportBuilderCapabilities(body, scope);
      if (!controller.signal.aborted) {
        setCapabilities({ scope: requestScope, value: verified });
        setNotice(current => current?.key === "capabilities:" + requestScope ? null : current);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setCapabilities(null);
        setPreview(null);
        setNotice({ key: "capabilities:" + requestScope, message: "Report fields are unavailable." });
      }
    });
    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [organizationId, capabilityScope]);

  function invalidate() {
    generation.current += 1;
    setPreview(null);
    setNotice(null);
    setBusyKey(null);
  }

  function selectDataset(next: ReportBuilderDataset) {
    invalidate();
    setDataset(next);
    const allowed = activeCapabilities?.[next] ?? [];
    setFields(DEFAULT_FIELDS[next].filter(field => allowed.includes(field)));
    setGroupBy(allowed.includes("department") ? "department" : "");
  }

  async function run(format: "json" | "csv") {
    if (!activeCapabilities || selected.fields.length === 0 || busy) return;
    // CSV is only available after the user previews the exact same employer,
    // fields, grouping and date window. The server still authorizes every POST.
    if (format === "csv" && !visiblePreview) return;
    const request = ++generation.current;
    setBusyKey(key);
    setNotice(null);
    if (format === "json") setPreview(null);
    try {
      const response = await fetch("/api/reports/builder", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, startDate, endDate, format,
          spec: { dataset, fields: selected.fields, groupBy: selected.groupBy },
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw Error(typeof data.error === "string" ? data.error : "Report request failed.");
      }
      if (format === "csv") {
        verifyReportBuilderCsvResponse(response);
        const csv = await response.blob();
        if (!csv.size) throw Error("Report export returned an empty document.");
        if (generation.current !== request) return;
        const href = URL.createObjectURL(csv);
        const link = document.createElement("a");
        link.href = href;
        link.download = "linaw-tenant-report.csv";
        link.click();
        URL.revokeObjectURL(href);
      } else {
        const data: unknown = await response.json();
        if (generation.current !== request) return;
        const verified = verifyReportBuilderPreview(data, dataset, selected.fields);
        setPreview({ key, ...verified });
      }
    } catch (reason) {
      if (generation.current === request) {
        setPreview(null);
        setNotice({ key, message: reason instanceof Error ? reason.message : "Report failed." });
      }
    } finally {
      if (generation.current === request) setBusyKey(null);
    }
  }

  return <section className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Custom reports</h1>
    <p>Choose approved fields, group rows, preview, or export an audited CSV. No SQL editing.</p>
    {!activeCapabilities && !error && <p role="status">Loading authorized report fields…</p>}
    <div className="flex flex-wrap gap-4">
      <label>Dataset <select value={dataset} onChange={event => selectDataset(event.target.value as ReportBuilderDataset)}
        className="border rounded p-2">
        {(Object.keys(activeCapabilities ?? DEFAULT_FIELDS) as ReportBuilderDataset[]).map(value =>
          <option value={value} key={value}>{value}</option>)}
      </select></label>
      <label>From <input type="date" value={startDate}
        onChange={event => { invalidate(); setStartDate(event.target.value); }} className="border rounded p-2"/></label>
      <label>To <input type="date" value={endDate}
        onChange={event => { invalidate(); setEndDate(event.target.value); }} className="border rounded p-2"/></label>
      <label>Group by <select value={selected.groupBy ?? ""} onChange={event => {
        const next = event.target.value;
        invalidate();
        setGroupBy(next);
        setFields(prev => prev.filter(field => !["status", "employmentType", "department"].includes(field))
          .concat(next ? [next] : []));
      }} className="border rounded p-2">
        <option value="">No grouping</option>
        {selected.allowed.filter(field => ["department", "status", "employmentType"].includes(field))
          .map(field => <option key={field} value={field}>{field}</option>)}
      </select></label>
    </div>
    <fieldset className="border rounded p-4"><legend>Columns</legend>
      <div className="flex flex-wrap gap-4">
        {selected.allowed.map(field => <label key={field} className="flex items-center gap-2">
          <input type="checkbox" checked={selected.fields.includes(field)}
            disabled={Boolean(selected.groupBy) && ["department", "status", "employmentType"].includes(field) && field !== selected.groupBy}
            onChange={event => {
              invalidate();
              setFields(prev => event.target.checked ? [...prev, field] : prev.filter(value => value !== field));
            }}/>
          {field}
        </label>)}
      </div>
    </fieldset>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy || !activeCapabilities || selected.fields.length === 0}
        onClick={() => void run("json")} className="rounded border px-4 py-2">Preview</button>
      <button disabled={busy || !activeCapabilities || !visiblePreview}
        onClick={() => void run("csv")} className="rounded border px-4 py-2">Export CSV</button>
    </div>
    {busy && <p role="status">Preparing report…</p>}
    {error && <p role="alert">{error}</p>}
    {capabilityError && <button type="button" className="rounded border px-4 py-2"
      onClick={() => {
        invalidate();
        setCapabilities(null);
        setCapabilityRetry(current => current + 1);
      }}>Retry report fields</button>}
    {visiblePreview && <div className="overflow-auto">
      {visiblePreview.rows.length === 0 && <p role="status">No results for this selection.</p>}
      <table className="w-full border-collapse text-sm">
        <thead><tr>{visiblePreview.columns.map(column =>
          <th key={column} scope="col" className="border p-2 text-left">{column}</th>)}</tr></thead>
        <tbody>{visiblePreview.rows.map((row, i) => <tr key={i}>
          {row.map((cell,j) => <td key={j} className="border p-2">{cell}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}

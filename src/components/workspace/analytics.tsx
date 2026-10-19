"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, Download, FileBarChart2, Gauge, RefreshCw, ShieldCheck, TrendingDown, UsersRound, WalletCards } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { EnterpriseBiExportPanel } from "@/components/enterprise-bi-export-panel";
import { HcmReportBuilderPanel } from "./hcm-report-builder-panel";
import { GroupEntityReports } from "./multi-entity-ui";
import { useWorkflowUi } from "./workflow-ui-context";
import { readVerifiedReportPayload } from "@/lib/report-read-payload";
import { CustomReportBuilder } from "./custom-report-builder";
import { PeopleIntelligenceOverview } from "./people-intelligence";
import type { PeopleIntelligenceSummary } from "@/lib/hcm-people-intelligence";
import {
  EmptyState,
  ErrorState,
  Metric,
  PageHeading,
  StackedBars,
  TableSkeleton,
  money,
  shortMoney,
} from "./ui";

type ReportKey = "headcount" | "cost" | "turnover" | "compliance" | "assurance" | "workforce" | "lifecycle" | "people";

const REPORTS: Array<{ key: ReportKey; name: string; description: string; icon: typeof UsersRound }> = [
  { key: "people", name: "People Intelligence", description: "Verified as-of headcount, hires, exits, FTE, vacancies, recruitment and released payroll", icon: UsersRound },
  { key: "lifecycle", name: "Lifecycle governance", description: "Employment terms, decision timing, evidence coverage, handoffs and escalations", icon: ClipboardCheck },
  { key: "workforce", name: "Workforce operations", description: "Overtime, absence, coverage, schedule adherence, payroll variance and labor cost", icon: Gauge },
  { key: "headcount", name: "Headcount movement", description: "Active, leave, disciplinary and separating counts by employment type", icon: UsersRound },
  { key: "cost", name: "Payroll cost", description: "Gross, deductions and net by run, with the rule version applied", icon: WalletCards },
  { key: "turnover", name: "Turnover risk", description: "Separating and disciplinary headcount as a share of the workforce", icon: TrendingDown },
  { key: "compliance", name: "Compliance exceptions", description: "Punch exceptions and flagged entries requiring sign-off", icon: AlertTriangle },
  { key: "assurance", name: "Payroll assurance", description: "Blocking controls and material employee-level changes versus the previous payroll", icon: ShieldCheck },
];

type ReportResult = {
  key: string;
  columns: string[];
  rows: string[][];
  generatedAt?: string;
  peopleIntelligence?: PeopleIntelligenceSummary;
};

export function AnalyticsView({ data, notify, tenantReportBuilderEnabled = false }: { data: DashboardData; notify: Notify; tenantReportBuilderEnabled?: boolean }) {
  // Preserve the established flag-OFF default. For multi-entity sessions,
  // safeActive below selects only a certified employer-scoped report before
  // any API request, CSV export, or visible report selection.
  const customReportsEnabled = useWorkflowUi().reportBuilder;
  const [active, setActive] = useState<ReportKey>("workforce");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState("");
  // A report response is reusable only for the exact tenant, selected legal
  // employer, role, report, date window and reload revision that produced it.
  // Deriving visibility here prevents a one-render flash of the last employer's
  // rows during a React prop change, before an effect can start refetching.
  const [resolvedScopeKey, setResolvedScopeKey] = useState<string | null>(null);
  const [peopleAsOf, setPeopleAsOf] = useState("");
  const [peopleWindowDays, setPeopleWindowDays] = useState<30 | 90 | 180 | 365>(90);

  const organizationId = data.selectedOrganization.id;

  const [nonce, setNonce] = useState(0);
  // Derived, not an effect-driven state change: a mid-session employer switch
  // cannot fetch or export a report not certified for a single legal employer.
  const employerScoped = data.multiEntity?.enabled === true && data.multiEntity.legalEntityId !== null;
  const supportedEmployerReports: ReportKey[] = ["headcount", "cost", "turnover", "assurance"];
  const safeActive: ReportKey = employerScoped && !supportedEmployerReports.includes(active)
    ? "headcount" : active;
  const requestScopeKey = JSON.stringify({
    organizationId,
    enabled: data.multiEntity?.enabled === true,
    legalEntityId: data.multiEntity?.enabled ? data.multiEntity.legalEntityId : null,
    role: data.multiEntity?.enabled ? data.multiEntity.role : "legacy",
    report: safeActive,
    peopleAsOf,
    peopleWindowDays,
    nonce,
  });
  const visibleResult = resolvedScopeKey === requestScopeKey ? result : null;
  const visibleState = resolvedScopeKey === requestScopeKey ? state : "loading";
  const visibleError = resolvedScopeKey === requestScopeKey ? error : "";

  // The fetch lives in the effect and every state update happens after an
  // await, so switching report or client never cascades a synchronous render.
  // `alive` stops a slow response from overwriting a newer one.
  useEffect(() => {
    if (data.multiEntity?.enabled && data.multiEntity.role === "group_hr") return;
    let alive = true;
    (async () => {
      try {
        const query = new URLSearchParams({ organizationId: String(organizationId), key: safeActive });
        if (safeActive === "people") {
          if (peopleAsOf) query.set("asOf", peopleAsOf);
          query.set("windowDays", String(peopleWindowDays));
        }
        const payload = await readVerifiedReportPayload(
          organizationId, safeActive, query, fetch,
          data.multiEntity?.enabled ? data.multiEntity.legalEntityId : null,
        );
        if (!alive) return;
        setResult(payload);
        setError("");
        setState("ready");
        setResolvedScopeKey(requestScopeKey);
      } catch (cause) {
        if (!alive) return;
        setResult(null);
        setError(cause instanceof Error ? cause.message : "Report source or scope could not be verified.");
        setState("error");
        setResolvedScopeKey(requestScopeKey);
      }
    })();
    return () => {
      alive = false;
    };
  }, [organizationId, safeActive, nonce, peopleAsOf, peopleWindowDays,
    data.multiEntity?.enabled, data.multiEntity?.role, data.multiEntity?.legalEntityId,
    requestScopeKey]);

  const reload = useCallback(() => {
    setState("loading");
    setNonce((current) => current + 1);
  }, []);

  // Cost history straight from the run records, the same numbers the register shows.
  const costSeries = useMemo(
    () =>
      [...data.payrollRuns].reverse().map((run) => {
        const gross = Number(run.grossPay);
        const net = Number(run.netPay);
        return {
          label: run.periodLabel.replace(/,?\s*\d{4}$/, "").slice(0, 9),
          sublabel: `${run.periodLabel} · ${run.employeeCount} people`,
          segments: [
            { key: "net", value: net, color: "var(--brand)" },
            { key: "deductions", value: Math.max(gross - net, 0), color: "var(--active-bright)" },
          ],
        };
      }),
    [data.payrollRuns],
  );

  const totalCost = data.payrollRuns.reduce((sum, run) => sum + Number(run.grossPay), 0);
  const totalNet = data.payrollRuns.reduce((sum, run) => sum + Number(run.netPay), 0);
  const exceptions = data.payrollRuns.reduce((sum, run) => sum + run.exceptions, 0);

  if (data.multiEntity?.enabled && data.multiEntity.role === "group_hr") {
    return <>
      <PageHeading eyebrow="Group HR" title="Group headcount and payroll cost"
        copy="Read-only company-by-company headcount and released payroll cost. Legal employers remain separate." />
      <GroupEntityReports context={data.multiEntity} organizationId={organizationId} />
    </>;
  }

  return (
    <>
      <PageHeading
        eyebrow="Insights"
        title="Reports"
        copy="Explore payroll, people and workforce records. Preview a report before exporting."
        actions={
          <button className="secondary-button" onClick={reload} disabled={visibleState === "loading"}>
            <RefreshCw size={15} className="i-blue" /> Refresh
          </button>
        }
      />

      {data.multiEntity?.enabled && data.multiEntity.group && <GroupEntityReports
        context={data.multiEntity} organizationId={organizationId} />}
      {customReportsEnabled && !data.multiEntity?.enabled && <CustomReportBuilder organizationId={organizationId}
        active={safeActive} report={visibleResult} onReport={key => { setActive(key as ReportKey); setState("loading"); }} />}
      <section className="stats-grid">
        <Metric
          label="Runs on record"
          value={String(data.payrollRuns.length)}
          hint={`${data.employees.length} people on this client`}
          icon={<FileBarChart2 size={16} className="i-teal" />}
          tone="blue"
        />
        <Metric label="Gross on record" value={shortMoney(totalCost)} hint="all stored runs, including unreleased" icon={<WalletCards size={16} className="i-green" />} tone="mint" />
        <Metric label="Net on record" value={shortMoney(totalNet)} hint="all stored runs, including unreleased" icon={<WalletCards size={16} className="i-green" />} tone="blue" />
        <Metric
          label="Open exceptions"
          value={String(exceptions)}
          hint={exceptions ? "across all runs" : "nothing flagged"}
          icon={<AlertTriangle size={16} className="i-red" />}
          tone={exceptions ? "amber" : "slate"}
        />
      </section>

      {costSeries.length > 0 && (
        <article className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">Payroll cost history</div>
              <h2>Net pay and deductions by run</h2>
              <p>Read from the stored run records, hover a bar for the period and headcount.</p>
            </div>
          </div>
          <StackedBars
            data={costSeries}
            legend={[
              { key: "net", label: "Net pay", color: "var(--brand)" },
              { key: "deductions", label: "Employee deductions", color: "var(--active-bright)" },
            ]}
          />
        </article>
      )}

      {/* The legacy BI/HCM builders are not certified for employer-specific
          permissions. Hide both when multi-entity isolation is enabled;
          API authorization is enforced independently of this UI guard. */}
      {!data.multiEntity?.enabled && (
        <>
          <EnterpriseBiExportPanel organizationId={organizationId} notify={notify} />
          {tenantReportBuilderEnabled && data.access?.companyWide === true && ["owner", "admin", "bookkeeper", "hr", "payroll"].includes(data.access?.role ?? "") && <HcmReportBuilderPanel key={organizationId} organizationId={organizationId} />}
        </>
      )}

      <div className="report-grid">
        {REPORTS.filter(report => !employerScoped || supportedEmployerReports.includes(report.key)).map((report) => {
          const Icon = report.icon;
          return (
            <button
              key={report.key}
              className={`report-hero ${safeActive === report.key ? "on" : ""}`}
              onClick={() => {
                setState("loading");
                setActive(report.key);
              }}
              aria-pressed={safeActive === report.key}
            >
              <span className="report-icon" aria-hidden>
                <Icon size={15} />
              </span>
              <h3>{report.name}</h3>
              <p>{report.description}</p>
            </button>
          );
        })}
      </div>

      {safeActive === "people" && (
        <article className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">People Intelligence controls</div>
              <h2>Choose the workforce snapshot</h2>
              <p>Current-state vacancies and compensation cannot be backdated. Historical headcount is shown only when effective-dated records verify it.</p>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "0 18px 18px" }}>
            <label style={{ display: "grid", gap: 5 }}>
              Reporting date (blank = today in Manila)
              <input aria-label="People Intelligence reporting date" type="date" value={peopleAsOf}
                onChange={(event) => { setPeopleAsOf(event.target.value); setState("loading"); }} />
            </label>
            <label style={{ display: "grid", gap: 5 }}>
              Activity window
              <select aria-label="People Intelligence activity window" value={peopleWindowDays}
                onChange={(event) => { setPeopleWindowDays(Number(event.target.value) as 30 | 90 | 180 | 365); setState("loading"); }}>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>365 days</option>
              </select>
            </label>
          </div>
        </article>
      )}

      {safeActive === "people" && visibleState === "ready" && visibleResult?.peopleIntelligence && (
        <PeopleIntelligenceOverview report={visibleResult.peopleIntelligence} />
      )}

      <article className="card table-card">
        <div className="card-header">
          <div>
            <div className="card-kicker">Result</div>
            <h2>{REPORTS.find((report) => report.key === safeActive)?.name}</h2>
            <p>
              {visibleState === "ready" && visibleResult
                ? `${visibleResult.rows.length} row${visibleResult.rows.length === 1 ? "" : "s"} returned${visibleResult.generatedAt ? ` · generated ${new Date(visibleResult.generatedAt).toLocaleTimeString("en-PH")}` : ""}`
                : "Running the aggregate query…"}
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={visibleState !== "ready" || !visibleResult?.rows.length}
            onClick={() => {
              const query = new URLSearchParams({
                organizationId: String(organizationId), key: safeActive, format: "csv",
              });
              if (safeActive === "people") {
                if (peopleAsOf) query.set("asOf", peopleAsOf);
                query.set("windowDays", String(peopleWindowDays));
              }
              window.open(`/api/reports?${query.toString()}`, "_blank", "noopener");
              notify("Report CSV requested, the export is recorded in the audit trail.", "info");
            }}
          >
            <Download size={15} className="i-teal" /> Export CSV
          </button>
        </div>

        {visibleState === "loading" && <TableSkeleton rows={5} label="Running report" />}

        {visibleState === "error" && <ErrorState title="That report could not run" detail={visibleError} onRetry={reload} />}

        {visibleState === "ready" && visibleResult && (
          <>
            {visibleResult.rows.length === 0 ? (
              <EmptyState icon={<FileBarChart2 size={20} className="i-teal" />} title="No rows matched">
                This client has no data for that report yet. It fills in as payroll runs and employee records accumulate.
              </EmptyState>
            ) : (
              <div className="data-table-wrap slim-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      {visibleResult.columns.map((column) => (
                        <th key={column} className={isNumericColumn(column) ? "right" : undefined}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResult.rows.map((row, index) => (
                      <tr key={index}>
                        {row.map((cell, cellIndex) => {
                          const column = visibleResult.columns[cellIndex] ?? "";
                          const numeric = isNumericColumn(column);
                          return (
                            <td key={cellIndex} className={numeric ? "right num" : undefined}>
                              {numeric && isMoneyColumn(column) && cell !== "" && !Number.isNaN(Number(cell))
                                ? money(cell)
                                : cell}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </article>
    </>
  );
}

const MONEY_COLUMNS = ["gross", "deductions", "net", "avg monthly basic", "current", "delta"];
const NUMERIC_COLUMNS = [...MONEY_COLUMNS, "people", "employees", "count", "share of workforce"];

const isMoneyColumn = (column: string) => MONEY_COLUMNS.some((name) => column.toLowerCase().includes(name));
const isNumericColumn = (column: string) => NUMERIC_COLUMNS.some((name) => column.toLowerCase().includes(name));

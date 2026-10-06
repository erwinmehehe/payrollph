"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, FileBarChart2, RefreshCw, ShieldCheck, TrendingDown, UsersRound, WalletCards } from "lucide-react";
import type { DashboardData, Notify } from "./types";
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

type ReportKey = "headcount" | "cost" | "turnover" | "compliance" | "assurance";

const REPORTS: Array<{ key: ReportKey; name: string; description: string; icon: typeof UsersRound }> = [
  { key: "headcount", name: "Headcount movement", description: "Active, leave, disciplinary and separating counts by employment type", icon: UsersRound },
  { key: "cost", name: "Payroll cost", description: "Gross, deductions and net by run, with the rule version applied", icon: WalletCards },
  { key: "turnover", name: "Turnover risk", description: "Separating and disciplinary headcount as a share of the workforce", icon: TrendingDown },
  { key: "compliance", name: "Compliance exceptions", description: "Punch exceptions and flagged entries requiring sign-off", icon: AlertTriangle },
  { key: "assurance", name: "Payroll assurance", description: "Blocking controls and material employee-level changes versus the previous payroll", icon: ShieldCheck },
];

type ReportResult = { key: string; columns: string[]; rows: string[][]; generatedAt?: string };

export function AnalyticsView({ data, notify }: { data: DashboardData; notify: Notify }) {
  const [active, setActive] = useState<ReportKey>("cost");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState("");

  const organizationId = data.selectedOrganization.id;

  const [nonce, setNonce] = useState(0);

  // The fetch lives in the effect and every state update happens after an
  // await, so switching report or client never cascades a synchronous render.
  // `alive` stops a slow response from overwriting a newer one.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/reports?organizationId=${organizationId}&key=${active}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!alive) return;
        if (!response.ok) {
          setError(payload.error ?? `The report service returned ${response.status}.`);
          setState("error");
          return;
        }
        setResult(payload as ReportResult);
        setError("");
        setState("ready");
      } catch {
        if (!alive) return;
        setError("Could not reach the report service.");
        setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [organizationId, active, nonce]);

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

  return (
    <>
      <PageHeading
        eyebrow="Reports"
        title="Payroll and workforce reports."
        copy="Review payroll cost, headcount, exceptions and payroll assurance. Export a traceable CSV when you need it."
        actions={
          <button className="secondary-button" onClick={reload} disabled={state === "loading"}>
            <RefreshCw size={15} className="i-blue" /> Refresh
          </button>
        }
      />

      <section className="stats-grid">
        <Metric
          label="Runs on record"
          value={String(data.payrollRuns.length)}
          hint={`${data.employees.length} people on this client`}
          icon={<FileBarChart2 size={16} className="i-teal" />}
          tone="blue"
        />
        <Metric label="Total gross paid" value={shortMoney(totalCost)} hint="across every stored run" icon={<WalletCards size={16} className="i-green" />} tone="mint" />
        <Metric label="Total net paid" value={shortMoney(totalNet)} hint="after employee deductions" icon={<WalletCards size={16} className="i-green" />} tone="purple" />
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

      <div className="report-grid">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <button
              key={report.key}
              className={`report-hero ${active === report.key ? "on" : ""}`}
              onClick={() => {
                setState("loading");
                setActive(report.key);
              }}
              aria-pressed={active === report.key}
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

      <article className="card table-card">
        <div className="card-header">
          <div>
            <div className="card-kicker">Result</div>
            <h2>{REPORTS.find((report) => report.key === active)?.name}</h2>
            <p>
              {state === "ready" && result
                ? `${result.rows.length} row${result.rows.length === 1 ? "" : "s"} returned${result.generatedAt ? ` · generated ${new Date(result.generatedAt).toLocaleTimeString("en-PH")}` : ""}`
                : "Running the aggregate query…"}
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={state !== "ready" || !result?.rows.length}
            onClick={() => {
              window.open(`/api/reports?organizationId=${organizationId}&key=${active}&format=csv`, "_blank", "noopener");
              notify("Report CSV requested, the export is recorded in the audit trail.", "info");
            }}
          >
            <Download size={15} className="i-teal" /> Export CSV
          </button>
        </div>

        {state === "loading" && <TableSkeleton rows={5} label="Running report" />}

        {state === "error" && <ErrorState title="That report could not run" detail={error} onRetry={reload} />}

        {state === "ready" && result && (
          <>
            {result.rows.length === 0 ? (
              <EmptyState icon={<FileBarChart2 size={20} className="i-teal" />} title="No rows matched">
                This client has no data for that report yet. It fills in as payroll runs and employee records accumulate.
              </EmptyState>
            ) : (
              <div className="data-table-wrap slim-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column} className={isNumericColumn(column) ? "right" : undefined}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, index) => (
                      <tr key={index}>
                        {row.map((cell, cellIndex) => {
                          const column = result.columns[cellIndex] ?? "";
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

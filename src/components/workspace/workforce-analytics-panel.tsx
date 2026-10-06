"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Clock3, RefreshCw, UsersRound, WalletCards } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { Metric, Spinner } from "./ui";

type AnalyticsPayload = {
  window: { startDate: string; endDate: string; days: number };
  scope: { companyWide: boolean; orgUnitId: number | null; visibleEmployees: number };
  costVisible: boolean;
  summary: {
    activeHeadcount: number;
    requestedOtHours: number;
    approvedOtHours: number;
    pendingOtRequests: number;
    rejectedOtRequests: number;
    approvedLeaveDays: number;
    pendingLeaveDays: number;
    attendanceExceptions: number;
    punchRows: number;
    latestPayrollGross: number | null;
    previousPayrollGross: number | null;
    payrollGrossVariance: number | null;
  };
  trend: Array<{ month: string; overtimeMinutes: number; approvedLeaveDays: number; attendanceExceptions: number; payrollGross: number | null }>;
};

type CoveragePayload = {
  coverage: Array<{ gap: number; unavailableScheduledHeadcount: number }>;
  laborVariance: {
    summary: {
      requiredHours: number;
      scheduledHours: number;
      actualHours: number;
      actualVsRequiredHours: number;
      actualVsRequiredBaseCost: number | null;
    };
    costVisible: boolean;
  };
};

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function peso(value: number | null) {
  if (value == null) return "Restricted";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value);
}

export function WorkforceAnalyticsPanel({ data, notify }: { data: DashboardData; notify: Notify }) {
  const organizationId = data.selectedOrganization.id;
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
  const [coverage, setCoverage] = useState<CoveragePayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const analyticsParams = new URLSearchParams({
        organizationId: String(organizationId),
        startDate: isoDate(-89),
        endDate: isoDate(),
      });
      const coverageParams = new URLSearchParams({
        organizationId: String(organizationId),
        startDate: isoDate(),
        endDate: isoDate(13),
      });
      const [analyticsResponse, coverageResponse] = await Promise.all([
        fetch(`/api/workforce/analytics?${analyticsParams.toString()}`, { cache: "no-store" }),
        fetch(`/api/workforce/coverage?${coverageParams.toString()}`, { cache: "no-store" }),
      ]);
      const analyticsBody = await analyticsResponse.json().catch(() => ({}));
      const coverageBody = await coverageResponse.json().catch(() => ({}));
      if (!analyticsResponse.ok) throw new Error(analyticsBody.error ?? "Could not load workforce analytics.");
      if (!coverageResponse.ok) throw new Error(coverageBody.error ?? "Could not load workforce coverage analytics.");
      setPayload(analyticsBody as AnalyticsPayload);
      setCoverage(coverageBody as CoveragePayload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load workforce analytics.", "err");
    } finally {
      setLoading(false);
    }
  }, [notify, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const coverageGaps = useMemo(() => (coverage?.coverage ?? []).filter((row) => row.gap > 0).length, [coverage]);
  const uncoveredSlots = useMemo(() => (coverage?.coverage ?? []).reduce((sum, row) => sum + row.gap, 0), [coverage]);

  return (
    <article className="card" style={{ marginBottom: 16 }} data-wfm-enterprise-analytics>
      <div className="card-header">
        <div>
          <div className="card-kicker">Enterprise workforce analytics</div>
          <h2>Overtime, absence, coverage and labor variance in one view.</h2>
          <p>90-day workforce operations plus the next 14 days of exact required → scheduled → actual coverage.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      {payload && coverage && (
        <>
          <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
            <Metric label="Approved OT" value={`${payload.summary.approvedOtHours.toLocaleString("en-PH", { maximumFractionDigits: 1 })}h`} hint={`${payload.summary.pendingOtRequests} pending request(s)`} icon={<Clock3 size={16} />} tone={payload.summary.pendingOtRequests ? "amber" : "blue"} />
            <Metric label="Approved leave" value={`${payload.summary.approvedLeaveDays.toLocaleString("en-PH", { maximumFractionDigits: 1 })}d`} hint={`${payload.summary.pendingLeaveDays.toLocaleString("en-PH", { maximumFractionDigits: 1 })} pending days`} icon={<CalendarDays size={16} />} tone="purple" />
            <Metric label="Coverage gaps" value={String(coverageGaps)} hint={`${uncoveredSlots} uncovered slot(s) in next 14 days`} icon={<UsersRound size={16} />} tone={coverageGaps ? "amber" : "mint"} />
            <Metric label="Attendance exceptions" value={String(payload.summary.attendanceExceptions)} hint={`${payload.summary.punchRows} punch row(s) reviewed`} icon={<AlertTriangle size={16} />} tone={payload.summary.attendanceExceptions ? "amber" : "slate"} />
          </section>

          <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
            <Metric label="Required labor" value={`${coverage.laborVariance.summary.requiredHours.toLocaleString("en-PH", { maximumFractionDigits: 1 })}h`} hint="next 14 days" icon={<UsersRound size={16} />} tone="slate" />
            <Metric label="Scheduled labor" value={`${coverage.laborVariance.summary.scheduledHours.toLocaleString("en-PH", { maximumFractionDigits: 1 })}h`} hint="rostered capacity" icon={<Clock3 size={16} />} tone="blue" />
            <Metric label="Actual labor" value={`${coverage.laborVariance.summary.actualHours.toLocaleString("en-PH", { maximumFractionDigits: 1 })}h`} hint={`${coverage.laborVariance.summary.actualVsRequiredHours >= 0 ? "+" : ""}${coverage.laborVariance.summary.actualVsRequiredHours.toLocaleString("en-PH", { maximumFractionDigits: 1 })}h vs required`} icon={<Clock3 size={16} />} tone={coverage.laborVariance.summary.actualVsRequiredHours < 0 ? "amber" : "mint"} />
            <Metric label="Payroll variance" value={peso(payload.summary.payrollGrossVariance)} hint={payload.costVisible ? "latest gross vs previous run" : "restricted to People/Payroll"} icon={<WalletCards size={16} />} tone="green" />
          </section>

          <div className="data-table-wrap slim-scroll" style={{ margin: "0 18px 18px" }}>
            <table className="data-table">
              <thead><tr><th>Month</th><th className="right">OT hours</th><th className="right">Leave days</th><th className="right">Attendance exceptions</th><th className="right">Payroll gross</th></tr></thead>
              <tbody>
                {payload.trend.map((row) => (
                  <tr key={row.month}>
                    <td><strong>{row.month}</strong></td>
                    <td className="right">{(row.overtimeMinutes / 60).toLocaleString("en-PH", { maximumFractionDigits: 1 })}</td>
                    <td className="right">{row.approvedLeaveDays.toLocaleString("en-PH", { maximumFractionDigits: 1 })}</td>
                    <td className="right">{row.attendanceExceptions}</td>
                    <td className="right">{peso(row.payrollGross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </article>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  BriefcaseBusiness,
  Gauge,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserRoundCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";

type HcmAnalytics = {
  generatedAt: string;
  asOfDate: string;
  privacyThreshold: number;
  executive: {
    activeHeadcount: number;
    netGrowthYtd: number;
    turnoverRateYtd: number;
    openPositions: number;
    vacancyRate: number;
    medianTimeToFillDays: number | null;
    averagePerformanceScore: number | null;
    careerReadyEmployees: number | null;
    latestReportableEnps: number | null;
  };
  headcount: {
    current: number;
    openingYtd: number;
    hiresYtd: number;
    separationsYtd: number;
    turnoverRateYtd: number;
    trend: Array<{ key: string; label: string; date: string; headcount: number }>;
    methodology: string;
    scopeCaveat: string | null;
  };
  recruiting: {
    openRequisitions: number;
    applicants: number;
    hires: number;
    averageTimeToFillDays: number | null;
    medianTimeToFillDays: number | null;
    funnel: Array<{ stage: string; count: number }>;
    methodology: string;
  };
  workforce: {
    positions: number;
    positionStatus: Array<{ status: string; count: number }>;
    openPositions: number;
    filledPositions: number;
    vacancyRate: number;
    averageSpanOfControl: number | null;
    maxSpanOfControl: number;
    spanOfControl: Array<{ managerEmployeeId: number; managerName: string; directReports: number }>;
  };
  performance: {
    reportable: boolean;
    reviewCount: number | null;
    averageScore: number | null;
    medianScore: number | null;
    distribution: Array<{ label: string; count: number | null; suppressed: boolean }>;
    cycles: Array<{ cycleId: number; label: string; responseCount: number; averageScore: number; medianScore: number }>;
    suppressionReason: string | null;
  };
  compensation: {
    reportable: boolean;
    monthlyPayPopulation: number | null;
    bandCoveragePercent: number | null;
    averageCompaRatio: number | null;
    distribution: Array<{ label: string; count: number | null; suppressed: boolean }>;
    suppressedBucketsPresent: boolean;
    latestCycle: {
      id: number;
      name: string;
      status: string;
      effectiveDate: string;
      totalBudget: number | null;
      visibleCommittedAnnualizedIncrease: number;
    } | null;
    suppressionReason: string | null;
  };
  mobility: {
    reportable: boolean;
    employeesWithReadiness: number | null;
    readyForMove: number | null;
    readyForMovePercent: number | null;
    verifiedSkillCoveragePercent: number | null;
    targetProfiles: Array<{ jobProfileId: number; title: string; count: number }>;
    suppressionReason: string | null;
  };
  cost: {
    reportable: boolean;
    actualGrossYtd: number | null;
    actualNetYtd: number | null;
    employerStatutoryYtd: number | null;
    loadedPayrollYtd: number | null;
    employerBenefitMonthlyRunRate: number | null;
    forecastAnnualLoadedCost: number | null;
    positionSalaryBudget: number | null;
    forecastVsPositionBudget: number | null;
    workforcePlan: { id: number; name: string; budget: number } | null;
    methodology: string;
    suppressionReason: string | null;
    scopeCaveat: string | null;
  };
  engagement: {
    surveys: Array<{
      surveyId: number;
      name: string;
      kind: string;
      status: string;
      anonymous: boolean;
      date: string;
      reportable: boolean;
      responseCount: number | null;
      enps: number | null;
      averageRating: number | null;
    }>;
    methodology: string;
  };
  coverage: {
    employees: number;
    activeEmployees: number;
    positions: number;
    completedScoredReviews: number;
    monthlyPayWithBand: number;
    readinessEmployees: number;
    releasedPayrollEntriesYtd: number;
  };
};

const money = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value);

const number1 = (value: number | null) => value === null ? "Suppressed" : new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 }).format(value);

function Meter({ value, max, label, detail }: { value: number; max: number; label: string; detail?: string }) {
  const width = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 52px", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <div><strong style={{ fontSize: 12 }}>{label}</strong>{detail && <small style={{ display: "block", color: "var(--muted)" }}>{detail}</small>}</div>
      <div style={{ height: 8, background: "var(--surface-muted, #eef2f1)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: width + "%", height: "100%", background: "var(--brand)", borderRadius: 999 }} />
      </div>
      <strong className="num" style={{ textAlign: "right", fontSize: 12 }}>{value}</strong>
    </div>
  );
}

function AnalyticsMetric({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: ReactNode }) {
  return (
    <article className="stat-card">
      <div className="stat-icon blue">{icon}</div>
      <p>{label}</p>
      <h3>{value}</h3>
      <span>{hint}</span>
    </article>
  );
}

export function HcmAnalyticsPanel({ organizationId }: { organizationId: number }) {
  const [data, setData] = useState<HcmAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/hcm-analytics?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Could not load HCM analytics.");
        return;
      }
      setData(payload);
    } catch {
      setError("Could not reach the HCM analytics service.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const maxHeadcount = useMemo(
    () => Math.max(1, ...(data?.headcount.trend.map((row) => row.headcount) ?? [1])),
    [data],
  );
  const maxFunnel = useMemo(
    () => Math.max(1, ...(data?.recruiting.funnel.map((row) => row.count) ?? [1])),
    [data],
  );
  const maxPosition = useMemo(
    () => Math.max(1, ...(data?.workforce.positionStatus.map((row) => row.count) ?? [1])),
    [data],
  );
  const maxPerformance = useMemo(
    () => Math.max(1, ...(data?.performance.distribution.map((row) => row.count ?? 0) ?? [1])),
    [data],
  );

  if (loading && !data) {
    return <article className="card" style={{ padding: 24, marginBottom: 16 }}>Loading connected HCM analytics…</article>;
  }

  if (!data) {
    return (
      <article className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div className="notice notice-amber"><span>{error || "HCM analytics are unavailable."}</span></div>
        <button className="secondary-button" style={{ marginTop: 12 }} onClick={() => void load()}><RefreshCw size={14} /> Retry</button>
      </article>
    );
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <div>
          <div className="card-kicker">CONNECTED HCM INTELLIGENCE</div>
          <h2>People, talent, cost, and listening in one evidence model</h2>
          <p>As of {data.asOfDate}. Sensitive distributions require at least {data.privacyThreshold} people before they are shown.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh HCM</button>
      </div>

      {error && <div className="notice notice-amber" style={{ marginBottom: 12 }}><span>{error}</span></div>}

      <section className="stats-grid">
        <AnalyticsMetric label="ACTIVE HEADCOUNT" value={String(data.executive.activeHeadcount)} hint={`${data.executive.netGrowthYtd >= 0 ? "+" : ""}${data.executive.netGrowthYtd} net YTD`} icon={<UsersRound size={16} />} />
        <AnalyticsMetric label="TURNOVER YTD" value={data.executive.turnoverRateYtd.toFixed(1) + "%"} hint={`${data.headcount.separationsYtd} released separations`} icon={<TrendingUp size={16} />} />
        <AnalyticsMetric label="OPEN POSITIONS" value={String(data.executive.openPositions)} hint={data.executive.vacancyRate.toFixed(1) + "% open vacancy rate"} icon={<BriefcaseBusiness size={16} />} />
        <AnalyticsMetric label="MEDIAN TIME TO FILL" value={data.executive.medianTimeToFillDays === null ? "—" : Math.round(data.executive.medianTimeToFillDays) + "d"} hint={`${data.recruiting.hires} recorded hires`} icon={<Gauge size={16} />} />
        <AnalyticsMetric label="PERFORMANCE" value={data.executive.averagePerformanceScore === null ? "Suppressed" : data.executive.averagePerformanceScore.toFixed(2)} hint="completed scored reviews" icon={<BarChart3 size={16} />} />
        <AnalyticsMetric label="CAREER READY" value={data.executive.careerReadyEmployees === null ? "Suppressed" : String(data.executive.careerReadyEmployees)} hint="80%+ readiness, no critical gaps" icon={<UserRoundCheck size={16} />} />
        <AnalyticsMetric label="LATEST eNPS" value={data.executive.latestReportableEnps === null ? "—" : String(data.executive.latestReportableEnps)} hint="latest reportable survey" icon={<ShieldCheck size={16} />} />
        <AnalyticsMetric label="LOADED COST FORECAST" value={data.cost.forecastAnnualLoadedCost === null ? "Suppressed" : money(data.cost.forecastAnnualLoadedCost)} hint="gross + employer statutory + benefit run rate" icon={<WalletCards size={16} />} />
      </section>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card" style={{ padding: 18 }}>
          <div className="card-kicker">HEADCOUNT</div>
          <h3>12-month reconstructed workforce</h3>
          <p style={{ color: "var(--muted)", marginBottom: 16 }}>{data.headcount.methodology}</p>
          {data.headcount.scopeCaveat && <div className="notice notice-amber" style={{ marginBottom: 14 }}><span>{data.headcount.scopeCaveat}</span></div>}
          {data.headcount.trend.map((row) => <Meter key={row.key} label={row.label} value={row.headcount} max={maxHeadcount} />)}
          <div className="hcm-metric-strip" style={{ marginTop: 14 }}>
            <div><span>Opening YTD</span><strong>{data.headcount.openingYtd}</strong></div>
            <div><span>Hires YTD</span><strong>{data.headcount.hiresYtd}</strong></div>
            <div><span>Separations YTD</span><strong>{data.headcount.separationsYtd}</strong></div>
          </div>
        </article>

        <article className="card" style={{ padding: 18 }}>
          <div className="card-kicker">RECRUITING</div>
          <h3>Funnel and time-to-fill</h3>
          <p style={{ color: "var(--muted)", marginBottom: 16 }}>{data.recruiting.methodology}</p>
          {data.recruiting.funnel.map((row) => <Meter key={row.stage} label={row.stage} value={row.count} max={maxFunnel} />)}
          <div className="hcm-metric-strip" style={{ marginTop: 14 }}>
            <div><span>Open requisitions</span><strong>{data.recruiting.openRequisitions}</strong></div>
            <div><span>Avg fill</span><strong>{data.recruiting.averageTimeToFillDays === null ? "—" : Math.round(data.recruiting.averageTimeToFillDays) + "d"}</strong></div>
            <div><span>Median fill</span><strong>{data.recruiting.medianTimeToFillDays === null ? "—" : Math.round(data.recruiting.medianTimeToFillDays) + "d"}</strong></div>
          </div>
        </article>
      </section>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card" style={{ padding: 18 }}>
          <div className="card-kicker">WORKFORCE STRUCTURE</div>
          <h3>Positions and manager span</h3>
          <div style={{ marginTop: 14 }}>
            {data.workforce.positionStatus.map((row) => <Meter key={row.status} label={row.status} value={row.count} max={maxPosition} />)}
          </div>
          <div className="hcm-metric-strip" style={{ marginTop: 14 }}>
            <div><span>Vacancy rate</span><strong>{data.workforce.vacancyRate.toFixed(1)}%</strong></div>
            <div><span>Avg span</span><strong>{number1(data.workforce.averageSpanOfControl)}</strong></div>
            <div><span>Max span</span><strong>{data.workforce.maxSpanOfControl}</strong></div>
          </div>
          {data.workforce.spanOfControl.length > 0 && (
            <div className="data-table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table"><thead><tr><th>MANAGER</th><th className="right">DIRECT REPORTS</th></tr></thead>
              <tbody>{data.workforce.spanOfControl.slice(0, 8).map((row) => <tr key={row.managerEmployeeId}><td>{row.managerName}</td><td className="right num">{row.directReports}</td></tr>)}</tbody></table>
            </div>
          )}
        </article>

        <article className="card" style={{ padding: 18 }}>
          <div className="card-kicker">PERFORMANCE</div>
          <h3>Completed review distribution</h3>
          {!data.performance.reportable ? (
            <div className="notice" style={{ marginTop: 14 }}><ShieldCheck size={14} /><span>{data.performance.suppressionReason}</span></div>
          ) : (
            <>
              <div style={{ marginTop: 14 }}>{data.performance.distribution.map((row) => row.count === null
                ? <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border)" }}><span>{row.label}</span><strong>Suppressed</strong></div>
                : <Meter key={row.label} label={row.label} value={row.count} max={maxPerformance} />)}</div>
              <div className="hcm-metric-strip" style={{ marginTop: 14 }}>
                <div><span>Reviews</span><strong>{data.performance.reviewCount}</strong></div>
                <div><span>Average</span><strong>{number1(data.performance.averageScore)}</strong></div>
                <div><span>Median</span><strong>{number1(data.performance.medianScore)}</strong></div>
              </div>
            </>
          )}
          {data.performance.cycles.length > 0 && (
            <div className="data-table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table"><thead><tr><th>CYCLE</th><th className="right">AVG</th><th className="right">REVIEWS</th></tr></thead>
              <tbody>{data.performance.cycles.map((row) => <tr key={row.cycleId}><td>{row.label}</td><td className="right num">{row.averageScore.toFixed(2)}</td><td className="right num">{row.responseCount}</td></tr>)}</tbody></table>
            </div>
          )}
        </article>
      </section>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card" style={{ padding: 18 }}>
          <div className="card-kicker">COMPENSATION POSITION</div>
          <h3>Salary-band coverage without employee-level exposure</h3>
          {!data.compensation.reportable ? (
            <div className="notice" style={{ marginTop: 14 }}><ShieldCheck size={14} /><span>{data.compensation.suppressionReason}</span></div>
          ) : (
            <>
              <div className="hcm-metric-strip" style={{ marginTop: 14 }}>
                <div><span>Band coverage</span><strong>{number1(data.compensation.bandCoveragePercent)}%</strong></div>
                <div><span>Avg compa-ratio</span><strong>{number1(data.compensation.averageCompaRatio)}</strong></div>
                <div><span>Monthly cohort</span><strong>{data.compensation.monthlyPayPopulation ?? "Suppressed"}</strong></div>
              </div>
              <div style={{ marginTop: 14 }}>
                {data.compensation.distribution.map((row) => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                    <span>{row.label}</span><strong>{row.count === null ? "Suppressed" : row.count}</strong>
                  </div>
                ))}
              </div>
              {data.compensation.suppressedBucketsPresent && <small style={{ color: "var(--muted)" }}>Small compensation buckets remain hidden even when the overall cohort is reportable.</small>}
            </>
          )}
          {data.compensation.latestCycle && (
            <div className="notice" style={{ marginTop: 14 }}>
              <span><strong>{data.compensation.latestCycle.name}</strong> · {data.compensation.latestCycle.status} · visible committed annualized increase {money(data.compensation.latestCycle.visibleCommittedAnnualizedIncrease)}{data.compensation.latestCycle.totalBudget !== null ? ` of ${money(data.compensation.latestCycle.totalBudget)}` : ""}.</span>
            </div>
          )}
        </article>

        <article className="card" style={{ padding: 18 }}>
          <div className="card-kicker">INTERNAL MOBILITY</div>
          <h3>Evidence-backed career readiness</h3>
          {!data.mobility.reportable ? (
            <div className="notice" style={{ marginTop: 14 }}><ShieldCheck size={14} /><span>{data.mobility.suppressionReason}</span></div>
          ) : (
            <>
              <div className="hcm-metric-strip" style={{ marginTop: 14 }}>
                <div><span>Ready for move</span><strong>{data.mobility.readyForMove ?? "Suppressed"}</strong></div>
                <div><span>Ready rate</span><strong>{number1(data.mobility.readyForMovePercent)}%</strong></div>
                <div><span>Skill evidence</span><strong>{number1(data.mobility.verifiedSkillCoveragePercent)}%</strong></div>
              </div>
              {data.mobility.targetProfiles.length > 0 && (
                <div className="data-table-wrap" style={{ marginTop: 12 }}>
                  <table className="data-table"><thead><tr><th>TARGET PROFILE</th><th className="right">READY PEOPLE</th></tr></thead>
                  <tbody>{data.mobility.targetProfiles.map((row) => <tr key={row.jobProfileId}><td>{row.title}</td><td className="right num">{row.count}</td></tr>)}</tbody></table>
                </div>
              )}
            </>
          )}
        </article>
      </section>

      <article className="card" style={{ padding: 18, marginTop: 16 }}>
        <div className="card-kicker">LABOR COST</div>
        <h3>Payroll actuals vs annualized loaded forecast</h3>
        <p style={{ color: "var(--muted)" }}>{data.cost.methodology}</p>
        {!data.cost.reportable ? (
          <div className="notice" style={{ marginTop: 14 }}><ShieldCheck size={14} /><span>{data.cost.suppressionReason}</span></div>
        ) : (
          <div className="hcm-metric-strip" style={{ marginTop: 14 }}>
            <div><span>Gross YTD</span><strong>{money(data.cost.actualGrossYtd ?? 0)}</strong></div>
            <div><span>Employer statutory YTD</span><strong>{money(data.cost.employerStatutoryYtd ?? 0)}</strong></div>
            <div><span>Loaded payroll YTD</span><strong>{money(data.cost.loadedPayrollYtd ?? 0)}</strong></div>
            <div><span>Employer benefits / month</span><strong>{money(data.cost.employerBenefitMonthlyRunRate ?? 0)}</strong></div>
            <div><span>Annual loaded forecast</span><strong>{money(data.cost.forecastAnnualLoadedCost ?? 0)}</strong></div>
            <div><span>Position salary budget</span><strong>{money(data.cost.positionSalaryBudget ?? 0)}</strong></div>
          </div>
        )}
        {data.cost.forecastVsPositionBudget !== null && (
          <div className="notice" style={{ marginTop: 14 }}>
            <span>Forecast minus position salary budget: <strong>{money(data.cost.forecastVsPositionBudget)}</strong>. This is a planning comparison, not an accounting variance.</span>
          </div>
        )}
        {data.cost.workforcePlan && <div style={{ marginTop: 10, color: "var(--muted)" }}>Active workforce plan: <strong>{data.cost.workforcePlan.name}</strong> · {money(data.cost.workforcePlan.budget)}</div>}
        {data.cost.scopeCaveat && <div className="notice notice-amber" style={{ marginTop: 10 }}><span>{data.cost.scopeCaveat}</span></div>}
      </article>

      <article className="card" style={{ padding: 18, marginTop: 16 }}>
        <div className="card-kicker">ENGAGEMENT TREND</div>
        <h3>Privacy-safe listening history</h3>
        <p style={{ color: "var(--muted)" }}>{data.engagement.methodology}</p>
        <div className="data-table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead><tr><th>SURVEY</th><th>TYPE</th><th className="right">RESPONSES</th><th className="right">eNPS</th><th className="right">AVG RATING</th></tr></thead>
            <tbody>
              {data.engagement.surveys.length === 0 && <tr><td colSpan={5}><div className="empty-state">No engagement survey history yet.</div></td></tr>}
              {data.engagement.surveys.map((row) => (
                <tr key={row.surveyId}>
                  <td><strong>{row.name}</strong><small style={{ display: "block", color: "var(--muted)" }}>{row.status}{row.anonymous ? " · anonymous" : ""}</small></td>
                  <td>{row.kind}</td>
                  <td className="right num">{row.responseCount === null ? "Suppressed" : row.responseCount}</td>
                  <td className="right num">{row.enps === null ? "—" : row.enps}</td>
                  <td className="right num">{row.averageRating === null ? "—" : row.averageRating.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className="notice" style={{ marginTop: 16 }}>
        <ShieldCheck size={14} />
        <span>Coverage: {data.coverage.activeEmployees} active employees · {data.coverage.positions} positions · {data.coverage.completedScoredReviews} scored reviews · {data.coverage.monthlyPayWithBand} employees with matched bands · {data.coverage.releasedPayrollEntriesYtd} released payroll entries YTD. Small sensitive cohorts remain suppressed.</span>
      </div>
    </section>
  );
}

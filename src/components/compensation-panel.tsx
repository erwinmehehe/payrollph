"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, CheckCircle2, CircleDollarSign, Plus, RefreshCw, Scale, ShieldCheck, X } from "lucide-react";

type Access = { role: string; companyWide: boolean; orgUnitId: number | null };
type JobProfile = { id: number; title: string; family: string; level: string; grade: string | null };
type OrgUnit = { id: number; name: string; type: string };
type Band = { id: number; jobProfileId: number; orgUnitId: number | null; locationKey: string; minimumMonthly: string; midpointMonthly: string; maximumMonthly: string; active: boolean };
type Cycle = { id: number; name: string; effectiveDate: string; totalBudget: string; status: string };
type Pool = { id: number; cycleId: number; orgUnitId: number; managerEmployeeId: number | null; budget: string };
type Review = { id: number; finalScore: string | null; status: string };
type EmployeeComp = {
  employee: { id: number; firstName: string; lastName: string; title: string; orgUnitId: number | null; status: string };
  payProfile: { payBasis: string; rateAmount: string } | null;
  position: { id: number; code: string; jobProfileId: number; orgUnitId: number | null } | null;
  jobProfile: JobProfile | null;
  band: Band | null;
  currentMonthlyRate: number | null;
  compaRatio: number | null;
  latestPerformanceReview: Review | null;
};
type Recommendation = {
  id: number;
  cycleId: number;
  employeeId: number;
  orgUnitId: number | null;
  bandId: number | null;
  adjustmentType: string;
  currentMonthlyRate: string;
  proposedMonthlyRate: string;
  annualizedIncrease: string;
  rationale: string | null;
  bandExceptionReason: string | null;
  status: string;
  proposedByUserId: number | null;
  approvedByUserId: number | null;
};

const peso = (value: number | string | null | undefined) =>
  value === null || value === undefined ? "—" : `₱${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

export function CompensationPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [employees, setEmployees] = useState<EmployeeComp[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [jobProfiles, setJobProfiles] = useState<JobProfile[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCycle, setShowCycle] = useState(false);
  const [showBand, setShowBand] = useState(false);
  const [showPool, setShowPool] = useState(false);
  const [showRecommendation, setShowRecommendation] = useState(false);

  const [cycleForm, setCycleForm] = useState({ name: "", effectiveDate: "", totalBudget: "" });
  const [bandForm, setBandForm] = useState({ jobProfileId: "", orgUnitId: "", minimumMonthly: "", midpointMonthly: "", maximumMonthly: "" });
  const [poolForm, setPoolForm] = useState({ cycleId: "", orgUnitId: "", budget: "" });
  const [recommendationForm, setRecommendationForm] = useState({ cycleId: "", employeeId: "", proposedMonthlyRate: "", adjustmentType: "merit", rationale: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/compensation?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setNotice(payload.error ?? "Could not load compensation management.");
      setAccess(payload.access ?? null);
      setEmployees(payload.employees ?? []);
      setBands(payload.bands ?? []);
      setCycles(payload.cycles ?? []);
      setPools(payload.pools ?? []);
      setRecommendations(payload.recommendations ?? []);
      setJobProfiles(payload.jobProfiles ?? []);
      setOrgUnits(payload.orgUnits ?? []);
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const openCycles = cycles.filter((cycle) => cycle.status === "open");
  const activeCycle = openCycles[0] ?? cycles[0] ?? null;
  const activeRecommendations = activeCycle ? recommendations.filter((row) => row.cycleId === activeCycle.id) : [];
  const plannedIncrease = activeRecommendations
    .filter((row) => ["submitted", "approved", "applied"].includes(row.status))
    .reduce((sum, row) => sum + Number(row.annualizedIncrease), 0);
  const remainingBudget = activeCycle ? Number(activeCycle.totalBudget) - plannedIncrease : 0;
  const outOfBand = employees.filter((item) => {
    if (item.currentMonthlyRate === null || !item.band) return false;
    return item.currentMonthlyRate < Number(item.band.minimumMonthly) || item.currentMonthlyRate > Number(item.band.maximumMonthly);
  }).length;

  const employeeById = useMemo(() => new Map(employees.map((item) => [item.employee.id, item])), [employees]);
  const bandById = useMemo(() => new Map(bands.map((band) => [band.id, band])), [bands]);
  const cycleById = useMemo(() => new Map(cycles.map((cycle) => [cycle.id, cycle])), [cycles]);
  const unitById = useMemo(() => new Map(orgUnits.map((unit) => [unit.id, unit])), [orgUnits]);

  const role = access?.role ?? "";
  const canArchitect = Boolean(access?.companyWide && ["owner", "admin", "bookkeeper", "hr"].includes(role));
  const canPropose = ["owner", "admin", "bookkeeper", "hr", "manager"].includes(role);
  const canApprove = ["owner", "admin", "bookkeeper", "hr"].includes(role);
  const canApply = ["owner", "admin", "bookkeeper", "payroll"].includes(role);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/compensation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not save compensation data.");
    return payload;
  }

  async function createCycle(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "cycle", ...cycleForm, totalBudget: Number(cycleForm.totalBudget) });
      setCycleForm({ name: "", effectiveDate: "", totalBudget: "" });
      setShowCycle(false);
      await load();
      setNotice("Compensation review cycle created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create compensation cycle."); }
  }

  async function saveBand(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "band",
        jobProfileId: Number(bandForm.jobProfileId),
        orgUnitId: bandForm.orgUnitId ? Number(bandForm.orgUnitId) : null,
        minimumMonthly: Number(bandForm.minimumMonthly),
        midpointMonthly: Number(bandForm.midpointMonthly),
        maximumMonthly: Number(bandForm.maximumMonthly),
      });
      setBandForm({ jobProfileId: "", orgUnitId: "", minimumMonthly: "", midpointMonthly: "", maximumMonthly: "" });
      setShowBand(false);
      await load();
      setNotice("Salary band saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save salary band."); }
  }

  async function savePool(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "pool", cycleId: Number(poolForm.cycleId), orgUnitId: Number(poolForm.orgUnitId), budget: Number(poolForm.budget) });
      setPoolForm({ cycleId: "", orgUnitId: "", budget: "" });
      setShowPool(false);
      await load();
      setNotice("Manager budget pool saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save budget pool."); }
  }

  async function submitRecommendation(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "recommendation",
        cycleId: Number(recommendationForm.cycleId),
        employeeId: Number(recommendationForm.employeeId),
        proposedMonthlyRate: Number(recommendationForm.proposedMonthlyRate),
        adjustmentType: recommendationForm.adjustmentType,
        rationale: recommendationForm.rationale,
      });
      setRecommendationForm({ cycleId: "", employeeId: "", proposedMonthlyRate: "", adjustmentType: "merit", rationale: "" });
      setShowRecommendation(false);
      await load();
      setNotice("Compensation recommendation submitted for approval.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not submit recommendation."); }
  }

  async function decide(recommendation: Recommendation, action: "approve" | "reject") {
    const band = recommendation.bandId ? bandById.get(recommendation.bandId) : null;
    const proposed = Number(recommendation.proposedMonthlyRate);
    const outsideBand = band ? proposed < Number(band.minimumMonthly) || proposed > Number(band.maximumMonthly) : false;
    let bandExceptionReason = recommendation.bandExceptionReason ?? "";
    if (action === "approve" && outsideBand && !bandExceptionReason) {
      bandExceptionReason = window.prompt("This recommendation is outside the salary band. Enter the explicit exception reason:")?.trim() ?? "";
      if (!bandExceptionReason) return setNotice("Approval cancelled: a band exception reason is required.");
    }
    const response = await fetch("/api/compensation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recommendationId: recommendation.id, action, bandExceptionReason }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not decide recommendation.");
    await load();
    setNotice(action === "approve" ? "Compensation recommendation approved." : "Compensation recommendation rejected.");
  }

  async function applyRecommendation(recommendation: Recommendation) {
    const response = await fetch("/api/compensation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recommendationId: recommendation.id, action: "apply" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not apply compensation change.");
    await load();
    setNotice("Approved compensation change applied as an effective-dated pay revision.");
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">COMPENSATION</div>
          <h1>Govern salary ranges, budgets, and pay decisions.</h1>
          <p>Managers can recommend changes against salary bands and budget pools; approvers review them; payroll only receives an effective-dated revision after explicit approval.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          {canArchitect && <button className="secondary-button" onClick={() => setShowBand(!showBand)}><Scale size={15} /> Salary band</button>}
          {canArchitect && <button className="secondary-button" onClick={() => setShowPool(!showPool)}><CircleDollarSign size={15} /> Budget pool</button>}
          {canArchitect && <button className="primary-button" onClick={() => setShowCycle(!showCycle)}><Plus size={15} /> Review cycle</button>}
        </div>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card"><div className="stat-icon purple"><BadgeDollarSign size={19} /></div><p>ACTIVE CYCLE</p><h3>{activeCycle?.name ?? "None"}</h3><span>{activeCycle ? `Effective ${activeCycle.effectiveDate}` : "Create a review cycle"}</span></article>
        <article className="stat-card"><div className="stat-icon blue"><CircleDollarSign size={19} /></div><p>CYCLE BUDGET</p><h3>{peso(activeCycle?.totalBudget)}</h3><span>{peso(plannedIncrease)} proposed / approved</span></article>
        <article className="stat-card"><div className="stat-icon mint"><CheckCircle2 size={19} /></div><p>BUDGET REMAINING</p><h3>{peso(Math.max(0, remainingBudget))}</h3><span>{activeRecommendations.length} recommendations</span></article>
        <article className="stat-card"><div className="stat-icon orange"><Scale size={19} /></div><p>OUT OF BAND</p><h3>{outOfBand}</h3><span>Current monthly salaries outside assigned range</span></article>
      </section>

      {showCycle && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">COMPENSATION CYCLE</div><h2>Open a governed review window</h2></div><button className="icon-button" onClick={() => setShowCycle(false)}><X size={16} /></button></div>
          <form onSubmit={createCycle}><div className="setting-form">
            <label>Name<input required value={cycleForm.name} onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })} placeholder="2027 Merit Review" /></label>
            <label>Effective date<input required type="date" value={cycleForm.effectiveDate} onChange={(e) => setCycleForm({ ...cycleForm, effectiveDate: e.target.value })} /></label>
            <label>Total annualized increase budget<input required type="number" min="0" step="0.01" value={cycleForm.totalBudget} onChange={(e) => setCycleForm({ ...cycleForm, totalBudget: e.target.value })} /></label>
          </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowCycle(false)}>Cancel</button><button className="primary-button">Create cycle</button></div></form>
        </article>
      )}

      {showBand && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">SALARY ARCHITECTURE</div><h2>Set a monthly PHP range by job profile and location</h2></div><button className="icon-button" onClick={() => setShowBand(false)}><X size={16} /></button></div>
          <form onSubmit={saveBand}><div className="setting-form">
            <label>Job profile<select required value={bandForm.jobProfileId} onChange={(e) => setBandForm({ ...bandForm, jobProfileId: e.target.value })}><option value="">Select profile</option>{jobProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}</select></label>
            <label>Location / org unit<select value={bandForm.orgUnitId} onChange={(e) => setBandForm({ ...bandForm, orgUnitId: e.target.value })}><option value="">Company-wide fallback</option>{orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label>Minimum / month<input required type="number" min="1" value={bandForm.minimumMonthly} onChange={(e) => setBandForm({ ...bandForm, minimumMonthly: e.target.value })} /></label>
            <label>Midpoint / month<input required type="number" min="1" value={bandForm.midpointMonthly} onChange={(e) => setBandForm({ ...bandForm, midpointMonthly: e.target.value })} /></label>
            <label>Maximum / month<input required type="number" min="1" value={bandForm.maximumMonthly} onChange={(e) => setBandForm({ ...bandForm, maximumMonthly: e.target.value })} /></label>
          </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowBand(false)}>Cancel</button><button className="primary-button">Save band</button></div></form>
        </article>
      )}

      {showPool && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">MANAGER BUDGET</div><h2>Allocate part of a cycle budget to an org unit</h2></div><button className="icon-button" onClick={() => setShowPool(false)}><X size={16} /></button></div>
          <form onSubmit={savePool}><div className="setting-form">
            <label>Cycle<select required value={poolForm.cycleId} onChange={(e) => setPoolForm({ ...poolForm, cycleId: e.target.value })}><option value="">Select cycle</option>{openCycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
            <label>Org unit<select required value={poolForm.orgUnitId} onChange={(e) => setPoolForm({ ...poolForm, orgUnitId: e.target.value })}><option value="">Select unit</option>{orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label>Annualized increase budget<input required type="number" min="0" step="0.01" value={poolForm.budget} onChange={(e) => setPoolForm({ ...poolForm, budget: e.target.value })} /></label>
          </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowPool(false)}>Cancel</button><button className="primary-button">Save pool</button></div></form>
        </article>
      )}

      {showRecommendation && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">PAY RECOMMENDATION</div><h2>Recommend a monthly pay change</h2></div><button className="icon-button" onClick={() => setShowRecommendation(false)}><X size={16} /></button></div>
          <form onSubmit={submitRecommendation}><div className="setting-form">
            <label>Cycle<select required value={recommendationForm.cycleId} onChange={(e) => setRecommendationForm({ ...recommendationForm, cycleId: e.target.value })}><option value="">Select cycle</option>{openCycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
            <label>Employee<select required value={recommendationForm.employeeId} onChange={(e) => {
              const employeeId = Number(e.target.value);
              const item = employeeById.get(employeeId);
              setRecommendationForm({ ...recommendationForm, employeeId: e.target.value, proposedMonthlyRate: item?.currentMonthlyRate?.toFixed(2) ?? "" });
            }}><option value="">Select monthly employee</option>{employees.filter((item) => item.currentMonthlyRate !== null).map((item) => <option key={item.employee.id} value={item.employee.id}>{item.employee.firstName} {item.employee.lastName} · {peso(item.currentMonthlyRate)}</option>)}</select></label>
            <label>Adjustment type<select value={recommendationForm.adjustmentType} onChange={(e) => setRecommendationForm({ ...recommendationForm, adjustmentType: e.target.value })}><option value="merit">Merit</option><option value="promotion">Promotion</option><option value="market">Market</option><option value="equity">Pay equity</option><option value="retention">Retention</option><option value="other">Other</option></select></label>
            <label>Proposed monthly pay<input required type="number" min="1" step="0.01" value={recommendationForm.proposedMonthlyRate} onChange={(e) => setRecommendationForm({ ...recommendationForm, proposedMonthlyRate: e.target.value })} /></label>
            <label style={{ gridColumn: "1 / -1" }}>Rationale<textarea required rows={3} value={recommendationForm.rationale} onChange={(e) => setRecommendationForm({ ...recommendationForm, rationale: e.target.value })} placeholder="Evidence, scope change, market movement, performance context, or equity rationale." /></label>
          </div><div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowRecommendation(false)}>Cancel</button><button className="primary-button">Submit recommendation</button></div></form>
        </article>
      )}

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div><div className="card-kicker">EMPLOYEE PAY POSITIONING</div><h2>Current salary vs assigned range</h2><p>Compa-ratio is current monthly pay divided by salary-band midpoint.</p></div>
          {canPropose && <button className="primary-button" onClick={() => setShowRecommendation(!showRecommendation)} disabled={!openCycles.length}><Plus size={14} /> Recommend change</button>}
        </div>
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>EMPLOYEE</th><th>JOB / UNIT</th><th className="right">CURRENT</th><th>RANGE</th><th className="right">COMPA-RATIO</th><th className="right">PERFORMANCE</th></tr></thead>
          <tbody>
            {employees.map((item) => (
              <tr key={item.employee.id}>
                <td><strong>{item.employee.firstName} {item.employee.lastName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{item.employee.title}</small></td>
                <td><strong>{item.jobProfile?.title ?? "No position profile"}</strong><small style={{ display: "block", color: "var(--muted)" }}>{item.employee.orgUnitId ? unitById.get(item.employee.orgUnitId)?.name ?? "Org unit" : "Company"}</small></td>
                <td className="right">{item.currentMonthlyRate !== null ? peso(item.currentMonthlyRate) : <span style={{ color: "var(--muted)" }}>{item.payProfile?.payBasis ?? "No pay profile"}</span>}</td>
                <td>{item.band ? <><strong>{peso(item.band.minimumMonthly)} – {peso(item.band.maximumMonthly)}</strong><small style={{ display: "block", color: "var(--muted)" }}>Mid {peso(item.band.midpointMonthly)}</small></> : <span style={{ color: "var(--muted)" }}>No band</span>}</td>
                <td className="right">{item.compaRatio !== null ? item.compaRatio.toFixed(2) : "—"}</td>
                <td className="right">{item.latestPerformanceReview?.finalScore ? `${Number(item.latestPerformanceReview.finalScore).toFixed(1)}/5` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </article>

      <article className="card">
        <div className="card-header"><div><div className="card-kicker">REVIEW QUEUE</div><h2>Recommendations, approvals, and payroll application</h2><p>Proposer and approver are separated. Approved changes remain pending until their effective date and an authorized payroll operator applies them.</p></div></div>
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>EMPLOYEE</th><th>CYCLE / TYPE</th><th className="right">CURRENT</th><th className="right">PROPOSED</th><th className="right">ANNUAL INCREASE</th><th>STATUS</th><th>ACTION</th></tr></thead>
          <tbody>
            {recommendations.length === 0 && <tr><td colSpan={7}><div className="empty-state">No compensation recommendations yet.</div></td></tr>}
            {recommendations.map((recommendation) => {
              const employee = employeeById.get(recommendation.employeeId);
              const cycle = cycleById.get(recommendation.cycleId);
              return (
                <tr key={recommendation.id}>
                  <td><strong>{employee ? `${employee.employee.firstName} ${employee.employee.lastName}` : `Employee #${recommendation.employeeId}`}</strong><small style={{ display: "block", color: "var(--muted)" }}>{recommendation.rationale ?? "No rationale"}</small></td>
                  <td><strong>{cycle?.name ?? `Cycle #${recommendation.cycleId}`}</strong><small style={{ display: "block", color: "var(--muted)" }}>{recommendation.adjustmentType}</small></td>
                  <td className="right">{peso(recommendation.currentMonthlyRate)}</td>
                  <td className="right"><strong>{peso(recommendation.proposedMonthlyRate)}</strong></td>
                  <td className="right">{peso(recommendation.annualizedIncrease)}</td>
                  <td><span className={recommendation.status === "applied" ? "status status-verified" : "status"}>{recommendation.status}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {canApprove && recommendation.status === "submitted" && <><button className="secondary-button" onClick={() => void decide(recommendation, "reject")}>Reject</button><button className="primary-button" onClick={() => void decide(recommendation, "approve")}><ShieldCheck size={12} /> Approve</button></>}
                      {canApply && recommendation.status === "approved" && <button className="primary-button" onClick={() => void applyRecommendation(recommendation)}>Apply to payroll</button>}
                      {!["submitted", "approved"].includes(recommendation.status) && <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </article>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">SALARY BANDS</div><h2>Range architecture</h2></div></div>
          {bands.length === 0 && <div className="empty-state">No salary bands configured.</div>}
          {bands.map((band) => <div className="leave-request" key={band.id}><div className="inline-icon purple"><Scale size={16} /></div><div style={{ flex: 1 }}><strong>{jobProfiles.find((profile) => profile.id === band.jobProfileId)?.title ?? `Job profile #${band.jobProfileId}`}</strong><span>{band.orgUnitId ? unitById.get(band.orgUnitId)?.name ?? "Location" : "Company-wide"} · {peso(band.minimumMonthly)} / {peso(band.midpointMonthly)} / {peso(band.maximumMonthly)}</span></div></div>)}
        </article>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">BUDGET POOLS</div><h2>Allocated increase budgets</h2></div></div>
          {pools.length === 0 && <div className="empty-state">No org-unit budget pools configured.</div>}
          {pools.map((pool) => <div className="leave-request" key={pool.id}><div className="inline-icon mint"><CircleDollarSign size={16} /></div><div style={{ flex: 1 }}><strong>{unitById.get(pool.orgUnitId)?.name ?? `Org unit #${pool.orgUnitId}`}</strong><span>{cycleById.get(pool.cycleId)?.name ?? `Cycle #${pool.cycleId}`}</span></div><strong>{peso(pool.budget)}</strong></div>)}
        </article>
      </section>
    </div>
  );
}

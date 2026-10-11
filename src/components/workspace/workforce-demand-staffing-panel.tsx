"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, ShieldCheck, TrendingUp } from "lucide-react";
import type { IssuedDemandSnapshot } from "@/lib/workforce-issued-demand-evidence";
import {
  buildDemandStaffingShiftEvidence, type DemandStaffingCoverage,
  type DemandStaffingCostRow, type DemandStaffingShift,
} from "@/lib/workforce-demand-staffing-evidence";
import { previewDemandToStaffing } from "@/lib/workforce-demand-staffing-planner";

type Site = {id: number; name: string; code: string; active: boolean};
type Shift = DemandStaffingShift & {name: string; code: string};
type Role = {id: number; title: string};
type RecoveryOption = {
  requirementId: number;
  gap: number;
  recommendations: Array<{
    employeeId: number; employeeName: string;
    workloadRisk: "low" | "medium" | "high";
    scheduledMinutesInWindow: number;
    consecutiveWorkingDaysBeforeShift: number | null;
    reasons: string[];
  }>;
};
type Issued = {
  id: number; worksiteId: number; issuedAt: string;
  snapshotSha256: string; integrity: "matches_issued_hash" | "source_review";
  snapshot: IssuedDemandSnapshot | null;
};
type ForecastResponse = {
  readOnly: true;
  scope: { organizationId: number; worksiteId: number };
  issued: Issued[];
};
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", minimumFractionDigits: 2,
});
const activity = (count: number | null) => count == null
  ? "Unknown" : count.toLocaleString("en-PH");
const staff = (count: number | null) => count == null ? "Unverified" : String(count);
const money = (count: number | null) => count == null ? "Unavailable" : peso.format(count);

/**
 * Feature-flagged, source-scoped manager what-if. Uses separately authorized,
 * no-store GET responses. There is no approval or roster-writing HTTP request.
 */
export function WorkforceDemandStaffingPanel({
  organizationId, worksites, shifts, jobProfiles, coverage, laborCostVisible,
  laborRows, recoveryOptions, guardrailBlockers, rosterStatus, windowStart, windowEnd,
  dynamicGroupCode,
}: {
  organizationId: number;
  worksites: Site[]; shifts: Shift[]; jobProfiles: Role[];
  coverage: DemandStaffingCoverage[];
  laborCostVisible: boolean; laborRows: DemandStaffingCostRow[];
  recoveryOptions: RecoveryOption[];
  guardrailBlockers: number; rosterStatus: string;
  windowStart: string; windowEnd: string; dynamicGroupCode: string;
}) {
  const [chosenSite, setChosenSite] = useState<number | null>(null);
  const [chosenShift, setChosenShift] = useState<number | null>(null);
  const [chosenRole, setChosenRole] = useState<string | null>(null);
  const [chosenIssue, setChosenIssue] = useState<number | null>(null);
  const [productivity, setProductivity] = useState("");
  const [serviceTarget, setServiceTarget] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; value: ForecastResponse } | null>(null);
  const [error, setError] = useState<{key: string; value: string} | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const site = worksites.find(w => w.active && w.id === chosenSite) ??
    worksites.find(w => w.active) ?? null;
  const worksiteId = site?.id ?? 0;
  const relevant = coverage.filter(r => r.worksiteId === worksiteId);
  const shiftIds = new Set(relevant.map(r => r.shiftDefinitionId));
  const availableShifts = shifts.filter(s => shiftIds.has(s.id));
  const shift = availableShifts.find(s => s.id === chosenShift) ?? availableShifts[0] ?? null;
  const roleValues = [...new Set(relevant.filter(r => r.shiftDefinitionId === shift?.id)
    .map(r => r.jobProfileId === null ? "any" : String(r.jobProfileId)))].sort();
  const roleKey = chosenRole && roleValues.includes(chosenRole) ? chosenRole : (roleValues[0] ?? "any");
  const jobProfileId = roleKey === "any" ? null : Number(roleKey);
  const scopeKey = [organizationId, worksiteId, refresh].join(":");

  useEffect(() => {
    if (!worksiteId) return;
    const controller = new AbortController();
    async function load() {
      setLoading(scopeKey);
      try {
        const q = new URLSearchParams({
          organizationId: String(organizationId), worksiteId: String(worksiteId),
        });
        const response = await fetch("/api/workforce/demand-observations/issued?" + q, {
          cache: "no-store", signal: controller.signal,
        });
        const value = await response.json().catch(() => ({})) as Partial<ForecastResponse> & {error?: string};
        if (!response.ok) throw new Error(value.error ?? "Issued forecast unavailable.");
        if (value.readOnly !== true || value.scope?.organizationId !== organizationId ||
          value.scope?.worksiteId !== worksiteId || !Array.isArray(value.issued)) {
          throw new Error("Issued demand source does not match the current employer and worksite.");
        }
        if (!controller.signal.aborted) {
          setLoaded({key:scopeKey,value:value as ForecastResponse});
          setError(null);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError({key:scopeKey,value:cause instanceof Error ? cause.message :
            "Issued demand source unavailable."});
        }
      } finally {
        if (!controller.signal.aborted) setLoading(null);
      }
    }
    void load();
    return () => controller.abort();
  }, [organizationId, worksiteId, scopeKey]);

  const issued = loaded?.key === scopeKey ? loaded.value.issued : [];
  const selected = issued.find(v => v.id === chosenIssue) ?? issued[0] ?? null;
  const product = Number(productivity);
  const target = Number(serviceTarget);
  const configured = productivity.trim() !== "" && serviceTarget.trim() !== "" &&
    Number.isFinite(product) && product >= 0.01 && product <= 1_000_000 &&
    Number.isFinite(target) && target > 0 && target <= 100 && acknowledged;
  const planning = useMemo(() => {
    if (!configured || !selected?.snapshot || !shift || dynamicGroupCode) return null;
    try {
      const evidence = buildDemandStaffingShiftEvidence({
        organizationId, worksiteId, shift, jobProfileId,
        snapshot: selected.snapshot,
        hashVerified: selected.integrity === "matches_issued_hash",
        windowStart, windowEnd, productivityUnitsPerHour: product,
        serviceTargetPercent: target, coverage, laborCostVisible, laborRows,
      });
      if (evidence.slots.length === 0) return {evidence, base:null, high:null, issue:null};
      const base = previewDemandToStaffing(evidence.slots);
      const high = previewDemandToStaffing(evidence.slots.map(row => ({
        ...row, predictedCount: row.upperScenarioCount,
      })));
      return {evidence,base,high,issue:null};
    } catch (cause) {
      return {evidence:null,base:null,high:null,
        issue:cause instanceof Error ? cause.message : "Demand staffing evidence requires review."};
    }
  }, [organizationId, worksiteId, shift, jobProfileId, selected, windowStart, windowEnd,
      product, target, configured, coverage, laborCostVisible, laborRows, dynamicGroupCode]);
  const base = planning?.base;
  const high = planning?.high;
  const unknown = base?.rows.filter(row => row.gapWorkers === null).length ?? 0;
  const roleLabel = (key: string) => key === "any" ? "Any job profile" :
    jobProfiles.find(p => p.id === Number(key))?.title ?? "Role #" + key;
  const reasons = [...new Set(base?.rows.flatMap(row => row.reviewReasons) ?? [])];
  const optionsByRequirement = new Map(recoveryOptions.map(row => [row.requirementId, row]));

  return (
    <section data-wfm-demand-staffing id="wfm-demand-staffing" style={{padding:"0 18px 18px"}}>
      <article className="card" style={{margin:0}}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Demand-to-staffing · manager what-if pilot</div>
            <h3>Turn forecast workload into a staffing review</h3>
            <p>Compare predicted peak transactions, visits, orders, appointments or calls with
              role-specific scheduled coverage. No shift is changed by this planner.</p>
          </div>
          <button type="button" className="secondary-button"
            disabled={!worksiteId || loading === scopeKey}
            onClick={() => {setReviewed(false);setRefresh(v=>v+1);}}>
            <RefreshCcw size={14}/> Refresh issued forecasts
          </button>
        </div>
        <div className="notice notice-slate" style={{margin:"0 18px 16px"}}>
          <TrendingUp size={15}/><span>
            Uses separately issued, time-stamped source-reported activity predictions.
            Productivity and service target are <strong>hypothetical manager inputs</strong>,
            not approved workforce policy. Peak-slot estimates can differ from average-shift staffing.
          </span>
        </div>
        {dynamicGroupCode && <div className="notice notice-amber" role="alert"
          style={{margin:"0 18px 16px"}}>
          Clear the Dynamic Group filter above before forecasting against the full worksite roster.
          A filtered roster cannot be compared to site-wide demand.
        </div>}
        <div className="setting-form" style={{padding:"0 18px 14px"}}>
          <label>Worksite
            <select aria-label="Demand planner worksite" value={worksiteId || ""}
              onChange={e=>{setChosenSite(Number(e.target.value));setChosenShift(null);setChosenRole(null);setChosenIssue(null);setReviewed(false);}}>
              {worksites.filter(w=>w.active).map(w=>
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </label>
          <label>Shift
            <select aria-label="Demand planner shift" value={shift?.id ?? ""}
              onChange={e=>{setChosenShift(Number(e.target.value));setChosenRole(null);setReviewed(false);}}>
              {availableShifts.map(s=>
                <option key={s.id} value={s.id}>{s.code} · {s.startTime}–{s.endTime}</option>)}
            </select>
          </label>
          <label>Job profile
            <select aria-label="Demand planner role" value={roleKey}
              onChange={e=>{setChosenRole(e.target.value);setReviewed(false);}}>
              {roleValues.map(key=><option key={key} value={key}>{roleLabel(key)}</option>)}
            </select>
          </label>
          <label>Issued workload forecast
            <select aria-label="Demand planner forecast issue" value={selected?.id ?? ""}
              onChange={e=>{setChosenIssue(Number(e.target.value));setReviewed(false);}}>
              {issued.map(row=><option key={row.id} value={row.id}>
                #{row.id} · {row.issuedAt.slice(0,10)} · {row.snapshot?.scope.metricKind ?? "Integrity review"}
              </option>)}
            </select>
          </label>
          <label>Productive activities per worker-hour
            <input aria-label="Hypothetical productive activities per worker-hour"
              type="number" min="0.01" step="0.25" max="1000000"
              value={productivity} placeholder="Enter agreed planning assumption"
              onChange={e=>{setProductivity(e.target.value);setReviewed(false);}}/>
          </label>
          <label>Service target (% of forecast volume staffed)
            <input aria-label="Hypothetical service coverage percentage"
              type="number" min="1" max="100" step="1"
              value={serviceTarget} placeholder="Enter 1–100"
              onChange={e=>{setServiceTarget(e.target.value);setReviewed(false);}}/>
          </label>
        </div>
        <label style={{display:"flex",alignItems:"start",gap:8,margin:"0 18px 16px"}}>
          <input type="checkbox" checked={acknowledged}
            onChange={e=>{setAcknowledged(e.target.checked);setReviewed(false);}}/>
          These are what-if productivity and service assumptions only. I have not approved
          headcount targets, pay rates, overtime or any schedule change.
        </label>
        {loading === scopeKey && <p role="status" style={{padding:"0 18px"}}>Loading scoped issued forecasts…</p>}
        {error?.key === scopeKey && <div className="notice notice-amber" role="alert"
          style={{margin:"0 18px 14px"}}>{error.value}</div>}
        {selected?.integrity === "source_review" && <div className="notice notice-amber"
          role="alert" style={{margin:"0 18px 16px"}}>
          Forecast hash integrity failed. This issued source cannot be used for staffing review.
        </div>}
        {!selected && !loading && !error && <div className="notice notice-amber"
          style={{margin:"0 18px 16px"}}>
          No issued demand forecast exists for this worksite. Issue a frozen forecast first
          through the separate authorized manager workflow.
        </div>}
        {worksiteId && !shift && <div className="notice notice-amber"
          style={{margin:"0 18px 16px"}} role="status">
          There is no role-specific staffing requirement for a shift in the selected
          coverage window. Establish and review the staffing baseline first.
        </div>}
        {!configured && <p className="id" style={{padding:"0 18px 16px"}}>
          Enter both hypothetical assumptions and acknowledge the boundary to compare rosters.
          No default productivity or service standard is assumed.
        </p>}
        {planning?.issue && <div className="notice notice-amber" role="alert"
          style={{margin:"0 18px 16px"}}>{planning.issue}</div>}
        {planning && !planning.issue && !base && <div className="notice notice-amber"
          role="status" style={{margin:"0 18px 16px"}}>
          {planning.evidence?.boundary}
        </div>}
        {base && high && planning?.evidence && <>
          <div className="module-grid two" style={{padding:"0 18px 16px"}}>
            <div className="card" style={{margin:0}}>
              <div className="card-header"><div><div className="card-kicker">Baseline demand scenario</div>
                <h4>Forecast peak activity</h4></div></div>
              <div style={{padding:"0 18px 18px"}}>
                <p><strong>{staff(base.totals.gaps)}</strong> worker-slot gap(s) across
                  the selected dates · {unknown} unverified date(s).</p>
                <p><strong>Indicative base cost of gaps:</strong> {money(base.totals.estimatedBaseCostPhp)}</p>
              </div>
            </div>
            <div className="card" style={{margin:0}}>
              <div className="card-header"><div><div className="card-kicker">Higher activity scenario</div>
                <h4>Upper forecast sensitivity</h4></div></div>
              <div style={{padding:"0 18px 18px"}}>
                <p><strong>{staff(high.totals.gaps)}</strong> worker-slot gap(s) across
                  the selected dates.</p>
                <p><strong>Indicative base cost of gaps:</strong> {money(high.totals.estimatedBaseCostPhp)}</p>
              </div>
            </div>
          </div>
          <div className="notice notice-amber" role="status"
            style={{margin:"0 18px 16px"}}>
            <ShieldCheck size={16}/><span>
              <strong>{base.status === "source_review" || guardrailBlockers > 0 ||
                rosterStatus !== "ready" ? "Reviewer evidence required." : "Scenario requires explicit approval."}</strong>
              {" "}This calculation has no certified pool of additional qualified, rested,
              available workers. Labor benchmarks (where authorized) are illustrative base-pay
              only; overtime, Philippine statutory premiums and projected final payroll cost
              are unverified. Roster status: {rosterStatus}; blocking guardrail issues: {guardrailBlockers}.
            </span>
          </div>
          <div className="data-table-wrap slim-scroll" style={{overflowX:"auto"}}>
            <table className="data-table" aria-label="Forecast demand staffing scenario comparison">
              <thead><tr>
                <th scope="col">PH work date</th>
                <th scope="col">Peak / total forecast</th>
                <th scope="col">Scheduled eligible</th>
                <th scope="col">Required baseline / high</th>
                <th scope="col">Baseline gap</th>
                <th scope="col">Existing recovery options</th>
                <th scope="col">Estimated extra base pay</th>
                <th scope="col">Review status</th>
              </tr></thead>
              <tbody>
                {base.rows.map((row,i)=><tr key={row.workDate + ":" + row.startTime}>
                  <td><strong>{row.workDate}</strong></td>
                  <td>{activity(planning.evidence!.evidence[i]?.peakPredictedCount ?? null)}
                    {" / "}{activity(planning.evidence!.evidence[i]?.totalPredictedActivity ?? null)}</td>
                  <td>{staff(row.scheduledWorkers)}</td>
                  <td>{staff(row.requiredWorkers)} / {staff(high.rows[i]?.requiredWorkers ?? null)}</td>
                  <td>{staff(row.gapWorkers)}</td>
                  <td>{(() => {
                    const related = optionsByRequirement.get(planning.evidence!.evidence[i]?.requirementId ?? -1);
                    if (!related) return "Not evaluated for the current requirement";
                    return <details><summary>{related.recommendations.length} ranked (limited to 5)</summary>
                      {related.recommendations.map(candidate => (
                        <p className="id" key={candidate.employeeId}>
                          {candidate.employeeName} · {candidate.workloadRisk} workload ·
                          {" "}{Math.round(candidate.scheduledMinutesInWindow / 60)}h already planned
                        </p>
                      ))}
                    </details>;
                  })()}</td>
                  <td>{money(row.estimatedAddedBaseCostPhp)}</td>
                  <td>{row.reviewReasons.length ? "Needs evidence" : "Review only"}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <p className="id" style={{padding:"10px 18px 8px"}}>
            Worksite: {site?.code} · Shift: {shift?.name} · Role: {roleLabel(roleKey)}
            {" "}· Forecast: #{selected?.id} · Source hash: {selected?.snapshotSha256.slice(0,12)}…
            {" "}· Missing evidence: {reasons.join(", ") || "none"}. Numbers are not additive
            across overlapping shifts or a substitute for worker-level qualification checks.
            Existing recovery options are ranked only for *recorded* gaps, capped at five,
            and are not proof of complete candidate availability, legal overtime or minimum rest.
          </p>
          <p className="id" style={{padding:"0 18px 12px"}}>{planning.evidence.boundary}</p>
          <label style={{display:"flex",alignItems:"start",gap:8,margin:"0 18px 14px"}}>
            <input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>
            I reviewed the hypothetical scenario and outstanding evidence. This acknowledgment
            is local to this screen and is NOT an approval or stored sign-off.
          </label>
          {reviewed && <div className="notice notice-slate" style={{margin:"0 18px 18px"}}>
            <span>Any employee-level proposal must be independently rechecked and staged in the existing
              role- and MFA-gated roster workflow. <a href="#wfm-smart-recovery">
              Open manager recovery and approval controls</a>. The planner never submits a schedule mutation.</span>
          </div>}
        </>}
      </article>
    </section>
  );
}

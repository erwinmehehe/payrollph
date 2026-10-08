"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

type Option = { id: number; label?: string; title?: string; roleCriteriaRecorded?: boolean };
type EvidenceRow = {
  skillId: number; code: string; name: string;
  minimumProficiency: number; mandatory: boolean; source: string;
  status: "verified_meets" | "verified_below" | "unverified";
  verifiedProficiency: number | null;
  lastCompletedReviewScore: number | null;
  lastCompletedReviewDate: string | null;
  developmentPlan: { id: number; status: string; targetDate: string; targetProficiency: number } | null;
};
type Comparison = {
  version: string; asOf: string; configured: boolean;
  target: { jobProfileId: number; profileTitle: string; capturedAt: string; fingerprint: string };
  counts: {
    total: number; mandatory: number; verifiedMeeting: number;
    verifiedBelow: number; unverified: number; activeDevelopmentPlans: number;
  };
  rows: EvidenceRow[];
  notice: string;
};
type EvidenceResponse = {
  employee: { id: number; label: string };
  requisition: { id: number; title: string; positionId: number };
  comparison: Comparison;
};

/**
 * Deliberately mounted only in the manager's Performance workspace.
 * Recruitment receives role criteria but never private employee comparisons.
 */
export function TalentContinuityPanel({ organizationId }: { organizationId: number }) {
  const [employees, setEmployees] = useState<Option[]>([]);
  const [requisitions, setRequisitions] = useState<Option[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [requisitionId, setRequisitionId] = useState("");
  const [result, setResult] = useState<EvidenceResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/performance/talent-continuity?organizationId=${organizationId}`, {
        cache: "no-store", signal,
      });
      if (signal?.aborted) return;
      if (response.status === 403) {
        setHidden(true);
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Talent evidence is unavailable.");
      if (signal?.aborted) return;
      setEmployees(data.employees ?? []);
      setRequisitions(data.requisitions ?? []);
      setResult(null);
      setHidden(false);
      setError("");
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load talent role evidence.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function compare() {
    if (!employeeId || !requisitionId) return;
    setReviewing(true);
    setError("");
    setResult(null);
    try {
      const query = new URLSearchParams({
        organizationId: String(organizationId),
        employeeId,
        requisitionId,
      });
      const response = await fetch(`/api/performance/talent-continuity?${query.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Cannot verify the selected role evidence.");
      setResult(data as EvidenceResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not compare evidence.");
    } finally {
      setReviewing(false);
    }
  }

  if (hidden) return null;
  return (
    <article className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">Private internal development</div>
          <h2>Skills → development → approved role</h2>
          <p>Compare verified employee skill records and completed review evidence with the role criteria frozen when an approved position opened for recruitment. This does not rank people or initiate a hire.</p>
        </div>
        <button type="button" className="secondary-button" disabled={loading || reviewing}
          onClick={() => void load()}><RefreshCw size={14} /> Refresh roles</button>
      </div>
      <div className="setting-form">
        <label>Employee
          <select aria-label="Employee for private role comparison" value={employeeId}
            onChange={(event) => { setEmployeeId(event.target.value); setResult(null); }}>
            <option value="">Choose an employee in your authorized scope</option>
            {employees.map((worker) => <option key={worker.id} value={worker.id}>{worker.label}</option>)}
          </select>
        </label>
        <label>Approved-position requisition
          <select aria-label="Target governed requisition" value={requisitionId}
            onChange={(event) => { setRequisitionId(event.target.value); setResult(null); }}>
            <option value="">Choose an open role</option>
            {requisitions.map((req) =>
              <option key={req.id} value={req.id}>{req.title} (#{req.id}){req.roleCriteriaRecorded ? "" : " · legacy criteria unavailable"}</option>
            )}
          </select>
        </label>
      </div>
      <div className="run-actions">
        <button type="button" className="primary-button" disabled={!employeeId || !requisitionId || reviewing || loading}
          onClick={() => void compare()}>
          <ClipboardCheck size={15} /> {reviewing ? "Checking evidence…" : "Review skill and development evidence"}
        </button>
      </div>
      {loading && <p>Loading authorized employees and approved positions…</p>}
      {!loading && !requisitions.length && <p>No open approved-position requisitions are visible in your authorized scope.</p>}
      {error && <p role="alert" style={{ color: "var(--danger, #b91c1c)" }}><TriangleAlert size={14} /> {error}</p>}
      {result && (
        <div style={{ marginTop: 18 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">Manager-only evidence</div>
              <h3 style={{ margin: 0 }}>{result.employee.label} → {result.requisition.title}</h3>
              <p>
                Role criteria frozen {result.comparison.target.capturedAt.slice(0, 10)} · verified skill evidence as of {result.comparison.asOf}
              </p>
            </div>
          </div>
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <article className="stat-card">
              <div className="stat-icon mint"><ShieldCheck size={17} /></div>
              <p>VERIFIED AT REQUIRED LEVEL</p>
              <h3>{result.comparison.counts.verifiedMeeting} / {result.comparison.counts.mandatory}</h3>
              <span>Mandatory competency evidence, not hire eligibility</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon orange"><TriangleAlert size={17} /></div>
              <p>BELOW / UNVERIFIED</p>
              <h3>{result.comparison.counts.verifiedBelow + result.comparison.counts.unverified}</h3>
              <span>Follow-up evidence needed</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon blue"><ClipboardCheck size={17} /></div>
              <p>DEVELOPMENT IN PROGRESS</p>
              <h3>{result.comparison.counts.activeDevelopmentPlans}</h3>
              <span>Development progress does not grant certification</span>
            </article>
          </div>
          {!result.comparison.configured && (
            <p role="status">The job profile has no recorded competency expectations. Ask a People administrator to define them; an empty competency set is not evidence of readiness.</p>
          )}
          <div className="data-table-wrap slim-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr><th>Role skill</th><th>Minimum level</th><th>Verified evidence</th><th>Completed review</th><th>Development plan</th></tr>
              </thead>
              <tbody>
                {result.comparison.rows.map((skill) => (
                  <tr key={skill.skillId}>
                    <td>
                      <strong>{skill.name}</strong>
                      <span style={{ display: "block", fontSize: 11 }}>
                        {skill.code} · {skill.source.replaceAll("_", " ")} · {skill.mandatory ? "mandatory" : "additional"}
                      </span>
                    </td>
                    <td>{skill.minimumProficiency}/5</td>
                    <td>{skill.status === "verified_meets" ? `Verified ${skill.verifiedProficiency}/5`
                      : skill.status === "verified_below" ? `Below: ${skill.verifiedProficiency}/5`
                        : "Unverified"}</td>
                    <td>{skill.lastCompletedReviewScore == null ? "No finalized review evidence"
                      : `${skill.lastCompletedReviewScore.toFixed(2)}/5 · ${skill.lastCompletedReviewDate ?? "date unavailable"}`}</td>
                    <td>{skill.developmentPlan
                      ? `#${skill.developmentPlan.id} · ${skill.developmentPlan.status.replaceAll("_", " ")} · target ${skill.developmentPlan.targetProficiency}/5 by ${skill.developmentPlan.targetDate}`
                      : "No matching plan"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: 12, fontSize: 12 }}>
            <ShieldCheck size={14} /> {result.comparison.notice}
            Individual ratings and development plans are not shared with the Recruitment module.
          </p>
        </div>
      )}
    </article>
  );
}

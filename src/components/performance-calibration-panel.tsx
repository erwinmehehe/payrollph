"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, Scale } from "lucide-react";

type Session = {
  id: number;
  cycleId: number;
  name: string;
  status: "open" | "finalized";
  notes: string | null;
  policyVersion: number | null;
  finalizedByName: string | null;
  finalizedAt: string | null;
};

type Entry = {
  id: number;
  sessionId: number;
  reviewId: number;
  originalScore: string;
  calibratedScore: string | null;
  rationale: string | null;
  calibratedByName: string | null;
  calibratedAt: string | null;
};

type Review = {
  id: number;
  employeeId: number;
  cycleId: number;
  status: string;
  finalScore: string | null;
};

type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  title: string;
};

type Cycle = {
  id: number;
  name: string;
  status: string;
  requireCalibration: boolean;
};

type CalibrationFlag = {
  id: number;
  sessionId: number;
  reviewId: number | null;
  reviewerUserId: number | null;
  flagType: string;
  severity: "warning" | "blocker";
  title: string;
  detail: string;
  observedValue: string | null;
  thresholdValue: string | null;
  status: "open" | "accepted" | "resolved";
  resolutionNote: string | null;
};

type CalibrationPolicy = {
  version: number;
  minimumManagerSample: number;
  managerMeanDeviationThreshold: number;
  highRatingThreshold: number;
  highRatingShareThreshold: number;
  lowRatingThreshold: number;
  lowRatingShareThreshold: number;
  largeScoreChangeThreshold: number;
  requireFlagResolution: boolean;
};

export function PerformanceCalibrationPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [flags, setFlags] = useState<CalibrationFlag[]>([]);
  const [policy, setPolicy] = useState<CalibrationPolicy | null>(null);
  const [policyForm, setPolicyForm] = useState({ minimumManagerSample: "3", managerMeanDeviationThreshold: "0.75", highRatingThreshold: "4.5", highRatingShareThreshold: "60", lowRatingThreshold: "2", lowRatingShareThreshold: "40", largeScoreChangeThreshold: "1", requireFlagResolution: true });
  const [flagNotes, setFlagNotes] = useState<Record<number, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ cycleId: "", name: "", notes: "" });
  const [scores, setScores] = useState<Record<number, string>>({});
  const [rationales, setRationales] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const response = await fetch("/api/performance/calibration?organizationId=" + organizationId, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not load performance calibration.");
      return;
    }
    setSessions(payload.sessions ?? []);
    setEntries(payload.entries ?? []);
    setReviews(payload.reviews ?? []);
    setEmployees(payload.employees ?? []);
    setCycles(payload.cycles ?? []);
    setFlags(payload.flags ?? []);
    const nextPolicy: CalibrationPolicy | null = payload.policy ?? null;
    setPolicy(nextPolicy);
    if (nextPolicy) setPolicyForm({
      minimumManagerSample: String(nextPolicy.minimumManagerSample),
      managerMeanDeviationThreshold: String(nextPolicy.managerMeanDeviationThreshold),
      highRatingThreshold: String(nextPolicy.highRatingThreshold),
      highRatingShareThreshold: String(nextPolicy.highRatingShareThreshold),
      lowRatingThreshold: String(nextPolicy.lowRatingThreshold),
      lowRatingShareThreshold: String(nextPolicy.lowRatingShareThreshold),
      largeScoreChangeThreshold: String(nextPolicy.largeScoreChangeThreshold),
      requireFlagResolution: nextPolicy.requireFlagResolution,
    });
    setFlagNotes(Object.fromEntries((payload.flags ?? []).map((flag: CalibrationFlag) => [flag.id, flag.resolutionNote ?? ""])));
    setScores(Object.fromEntries((payload.entries ?? []).map((entry: Entry) => [
      entry.id,
      entry.calibratedScore ? String(Number(entry.calibratedScore)) : String(Number(entry.originalScore)),
    ])));
    setRationales(Object.fromEntries((payload.entries ?? []).map((entry: Entry) => [
      entry.id,
      entry.rationale ?? "",
    ])));
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const employeeName = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee.firstName + " " + employee.lastName])),
    [employees],
  );
  const reviewById = useMemo(() => new Map(reviews.map((review) => [review.id, review])), [reviews]);
  const cycleById = useMemo(() => new Map(cycles.map((cycle) => [cycle.id, cycle])), [cycles]);

  async function createSession(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/performance/calibration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        cycleId: Number(form.cycleId),
        name: form.name,
        notes: form.notes,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not open calibration.");
      return;
    }
    setForm({ cycleId: "", name: "", notes: "" });
    setShowCreate(false);
    await load();
    setNotice("Performance calibration opened from completed manager ratings.");
  }

  async function saveEntry(session: Session, entry: Entry) {
    const response = await fetch("/api/performance/calibration", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "score",
        organizationId,
        sessionId: session.id,
        entryId: entry.id,
        calibratedScore: Number(scores[entry.id] ?? entry.originalScore),
        rationale: rationales[entry.id] ?? "",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not save calibrated rating.");
      return;
    }
    await load();
    setNotice("Calibrated rating saved with audit evidence.");
  }

  async function finalize(session: Session) {
    const response = await fetch("/api/performance/calibration", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "finalize",
        organizationId,
        sessionId: session.id,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not finalize calibration.");
      return;
    }
    await load();
    setNotice("Calibration finalized. Calibrated ratings are now the performance final ratings; compensation remains unchanged.");
  }

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/performance/calibration", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "policy",
        organizationId,
        expectedVersion: policy?.version ?? 0,
        minimumManagerSample: Number(policyForm.minimumManagerSample),
        managerMeanDeviationThreshold: Number(policyForm.managerMeanDeviationThreshold),
        highRatingThreshold: Number(policyForm.highRatingThreshold),
        highRatingShareThreshold: Number(policyForm.highRatingShareThreshold),
        lowRatingThreshold: Number(policyForm.lowRatingThreshold),
        lowRatingShareThreshold: Number(policyForm.lowRatingShareThreshold),
        largeScoreChangeThreshold: Number(policyForm.largeScoreChangeThreshold),
        requireFlagResolution: policyForm.requireFlagResolution,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not update calibration policy.");
      return;
    }
    await load();
    setNotice("Calibration distribution policy version updated. Existing sessions keep their frozen policy snapshot.");
  }

  async function closeFlag(session: Session, flag: CalibrationFlag, status: "accepted" | "resolved") {
    const response = await fetch("/api/performance/calibration", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "flag",
        organizationId,
        sessionId: session.id,
        flagId: flag.id,
        status,
        resolutionNote: flagNotes[flag.id] ?? "",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not close calibration flag.");
      return;
    }
    await load();
    setNotice(status === "accepted" ? "Calibration outlier accepted with rationale." : "Calibration outlier resolved.");
  }

  return (
    <article className="card" style={{ padding: 20 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">CALIBRATION</div>
          <h2>Review rating consistency before cycle closure</h2>
          <p>People administrators can confirm or adjust completed manager ratings. Any change requires rationale and remains separate from compensation.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
          <button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}><Scale size={14} /> New calibration</button>
        </div>
      </div>

      <form onSubmit={savePolicy} className="employee-edit-card" style={{ marginBottom: 18 }}>
        <div className="employee-list-card-head">
          <div>
            <span className="card-kicker">DISTRIBUTION POLICY · v{policy?.version ?? 0}</span>
            <h3>Outlier thresholds</h3>
            <p>New calibration sessions freeze these settings. Policy updates never rewrite an open session's thresholds.</p>
          </div>
        </div>
        <div className="setting-form">
          <label>Minimum manager sample<input type="number" min="2" step="1" value={policyForm.minimumManagerSample} onChange={(event) => setPolicyForm({ ...policyForm, minimumManagerSample: event.target.value })} /></label>
          <label>Mean deviation flag<input type="number" min="0.1" max="4" step="0.05" value={policyForm.managerMeanDeviationThreshold} onChange={(event) => setPolicyForm({ ...policyForm, managerMeanDeviationThreshold: event.target.value })} /></label>
          <label>High rating ≥<input type="number" min="1" max="5" step="0.1" value={policyForm.highRatingThreshold} onChange={(event) => setPolicyForm({ ...policyForm, highRatingThreshold: event.target.value })} /></label>
          <label>High share %<input type="number" min="0" max="100" step="1" value={policyForm.highRatingShareThreshold} onChange={(event) => setPolicyForm({ ...policyForm, highRatingShareThreshold: event.target.value })} /></label>
          <label>Low rating ≤<input type="number" min="1" max="5" step="0.1" value={policyForm.lowRatingThreshold} onChange={(event) => setPolicyForm({ ...policyForm, lowRatingThreshold: event.target.value })} /></label>
          <label>Low share %<input type="number" min="0" max="100" step="1" value={policyForm.lowRatingShareThreshold} onChange={(event) => setPolicyForm({ ...policyForm, lowRatingShareThreshold: event.target.value })} /></label>
          <label>Large score change<input type="number" min="0.1" max="4" step="0.1" value={policyForm.largeScoreChangeThreshold} onChange={(event) => setPolicyForm({ ...policyForm, largeScoreChangeThreshold: event.target.value })} /></label>
          <label><input type="checkbox" checked={policyForm.requireFlagResolution} onChange={(event) => setPolicyForm({ ...policyForm, requireFlagResolution: event.target.checked })} /> Require flag resolution before finalization</label>
        </div>
        <div className="run-actions"><button className="secondary-button">Save policy version</button></div>
      </form>

      {showCreate && (
        <form onSubmit={createSession} style={{ marginBottom: 18 }}>
          <div className="setting-form">
            <label>
              Cycle
              <select required value={form.cycleId} onChange={(event) => setForm({ ...form, cycleId: event.target.value })}>
                <option value="">Select cycle</option>
                {cycles.filter((cycle) => cycle.status !== "completed" && !sessions.some((session) => session.cycleId === cycle.id)).map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>{cycle.name + (cycle.requireCalibration ? " · required" : "")}</option>
                ))}
              </select>
            </label>
            <label>Session name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="2026 Annual Calibration" /></label>
            <label style={{ gridColumn: "1 / -1" }}>Notes<textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          </div>
          <div className="run-actions">
            <button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="primary-button">Open calibration</button>
          </div>
        </form>
      )}

      {sessions.length === 0 && <div className="empty-state">No calibration session has been opened.</div>}

      {sessions.map((session) => {
        const sessionEntries = entries.filter((entry) => entry.sessionId === session.id);
        const cycle = cycleById.get(session.cycleId);
        const pending = sessionEntries.filter((entry) => !entry.calibratedScore).length;
        const changed = sessionEntries.filter((entry) =>
          entry.calibratedScore && Math.abs(Number(entry.calibratedScore) - Number(entry.originalScore)) > 0.001
        ).length;

        return (
          <div className="employee-edit-card" key={session.id} style={{ marginBottom: 14 }}>
            <div className="employee-list-card-head">
              <div>
                <span className="card-kicker">{cycle?.name ?? "Performance cycle"}</span>
                <h3>{session.name}</h3>
                <p>{session.status === "finalized" ? "Finalized calibration" : "Open calibration"} · {changed} changed rating(s) · policy v{session.policyVersion ?? 0}</p>
              </div>
              {session.status === "finalized" ? <span className="employee-status-pill good">Finalized</span> : <span className="employee-status-pill warn">{pending} unscored</span>}
            </div>

            {session.notes && <p>{session.notes}</p>}

            {flags.filter((flag) => flag.sessionId === session.id).map((flag) => (
              <div className="employee-edit-card" key={flag.id} style={{ marginBottom: 10 }}>
                <div className="employee-list-card-head">
                  <div>
                    <span className="card-kicker">{flag.flagType.replaceAll("_", " ").toUpperCase()}</span>
                    <strong>{flag.title}</strong>
                    <p>{flag.detail}</p>
                  </div>
                  <span className={"employee-status-pill " + (flag.status === "open" ? (flag.severity === "blocker" ? "bad" : "warn") : "good")}>{flag.status}</span>
                </div>
                {flag.status === "open" && session.status === "open" && (
                  <>
                    <label>Resolution / acceptance rationale<input value={flagNotes[flag.id] ?? ""} onChange={(event) => setFlagNotes((current) => ({ ...current, [flag.id]: event.target.value }))} placeholder="Document why the distribution is acceptable or what was corrected." /></label>
                    <div className="run-actions">
                      <button type="button" className="secondary-button" onClick={() => void closeFlag(session, flag, "accepted")}>Accept with rationale</button>
                      <button type="button" className="primary-button" onClick={() => void closeFlag(session, flag, "resolved")}>Resolve</button>
                    </div>
                  </>
                )}
                {flag.status !== "open" && flag.resolutionNote && <p>Decision: {flag.resolutionNote}</p>}
              </div>
            ))}

            {sessionEntries.map((entry) => {
              const review = reviewById.get(entry.reviewId);
              const person = review ? employeeName.get(review.employeeId) : null;
              const proposed = scores[entry.id] ?? String(Number(entry.originalScore));
              const scoreChanged = Math.abs(Number(proposed) - Number(entry.originalScore)) > 0.001;

              return (
                <div className="leave-request" key={entry.id}>
                  <div style={{ flex: 1 }}>
                    <strong>{person ?? "Review #" + entry.reviewId}</strong>
                    <span>{"Manager final: " + Number(entry.originalScore).toFixed(1) + "/5"}</span>
                    {session.status === "finalized" && entry.calibratedScore && <span>{"Calibrated final: " + Number(entry.calibratedScore).toFixed(1) + "/5"}</span>}
                    {entry.rationale && <span>{"Rationale: " + entry.rationale}</span>}
                    {session.status === "open" && (
                      <div className="setting-form" style={{ marginTop: 8 }}>
                        <label>
                          Calibrated score
                          <input
                            type="number"
                            min="1"
                            max="5"
                            step="0.1"
                            value={proposed}
                            onChange={(event) => setScores((current) => ({ ...current, [entry.id]: event.target.value }))}
                          />
                        </label>
                        <label>
                          {scoreChanged ? "Change rationale · required" : "Rationale / note"}
                          <input
                            value={rationales[entry.id] ?? ""}
                            onChange={(event) => setRationales((current) => ({ ...current, [entry.id]: event.target.value }))}
                            placeholder={scoreChanged ? "Explain why this rating should change." : "Optional note"}
                          />
                        </label>
                        <button type="button" className="secondary-button" onClick={() => void saveEntry(session, entry)}>Save</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {session.status === "open" && (
              <div className="run-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    sessionEntries.some((entry) => !entry.calibratedScore)
                    || (policyForm.requireFlagResolution && flags.some((flag) => flag.sessionId === session.id && flag.status === "open"))
                  }
                  onClick={() => void finalize(session)}
                >
                  <CheckCircle2 size={14} /> Finalize calibration
                </button>
              </div>
            )}
          </div>
        );
      })}
    </article>
  );
}

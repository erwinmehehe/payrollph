"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";

type TermLifecycle = {
  state: "none" | "future" | "upcoming" | "due" | "overdue";
  dueDate: string | null;
  daysUntil?: number;
  action: string | null;
} | null;

type EmploymentTerm = {
  id: number;
  employmentType: string;
  termKind: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  probationReviewDate: string | null;
  contractEndDate: string | null;
  projectName: string | null;
  status: string;
  reason: string;
  requestedBy: string;
  approvedBy: string | null;
  failure: string | null;
  lifecycle?: TermLifecycle;
};

type EmploymentDecision = {
  id: number;
  employmentTermId: number;
  decisionKind: string;
  effectiveDate: string;
  nextEmploymentType: string | null;
  nextTermKind: string | null;
  nextEffectiveUntil: string | null;
  nextProbationReviewDate: string | null;
  nextContractEndDate: string | null;
  nextProjectName: string | null;
  proposedSeparationLastDay: string | null;
  separationReason: string | null;
  status: string;
  separationHandoffStatus: string;
  separationRecordId: number | null;
  reason: string;
  requestedBy: string;
  approvedBy: string | null;
  failure: string | null;
};

const TERM_KINDS = ["regular", "probationary", "fixed_term", "project", "seasonal", "casual", "other"] as const;

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function HcmEmploymentLifecycleWorker({
  organizationId,
  employeeId,
  currentEmploymentType,
  onChanged,
  onOpenSeparation,
}: {
  organizationId: number;
  employeeId: number;
  currentEmploymentType: string;
  onChanged?: () => Promise<unknown> | unknown;
  onOpenSeparation: () => void;
}) {
  const today = useMemo(() => manilaToday(), []);
  const [terms, setTerms] = useState<EmploymentTerm[]>([]);
  const [decisions, setDecisions] = useState<EmploymentDecision[]>([]);
  const [serverToday, setServerToday] = useState(today);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showTermForm, setShowTermForm] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);

  const [termForm, setTermForm] = useState({
    employmentType: currentEmploymentType || "Regular",
    termKind: "regular",
    effectiveFrom: today,
    effectiveUntil: "",
    probationReviewDate: "",
    contractEndDate: "",
    projectName: "",
    reason: "Initial governed employment terms",
  });

  const [decisionForm, setDecisionForm] = useState({
    decisionKind: "continue_current",
    effectiveDate: today,
    reason: "",
    nextEmploymentType: currentEmploymentType || "Regular",
    nextTermKind: "regular",
    nextEffectiveUntil: "",
    nextProbationReviewDate: "",
    nextContractEndDate: "",
    nextProjectName: "",
    proposedSeparationLastDay: "",
    separationReason: "End of contract / non-renewal",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [termRes, decisionRes] = await Promise.all([
        fetch(`/api/hcm/employment-terms?organizationId=${organizationId}&employeeId=${employeeId}`, { cache: "no-store" }),
        fetch(`/api/hcm/employment-term-decisions?organizationId=${organizationId}&employeeId=${employeeId}`, { cache: "no-store" }),
      ]);
      const termPayload = await termRes.json().catch(() => ({}));
      const decisionPayload = await decisionRes.json().catch(() => ({}));
      if (!termRes.ok) throw new Error(termPayload.error ?? "Could not load employment terms.");
      if (!decisionRes.ok) throw new Error(decisionPayload.error ?? "Could not load employment decisions.");
      setTerms(termPayload.terms ?? []);
      setDecisions(decisionPayload.decisions ?? []);
      if (termPayload.today) setServerToday(termPayload.today);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load employment lifecycle controls.");
    } finally {
      setLoading(false);
    }
  }, [employeeId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeTerm = terms.find((term) => term.status === "active") ?? null;
  const openTerm = terms.find((term) => ["pending_approval", "scheduled", "failed"].includes(term.status)) ?? null;
  const relevantDecision = decisions.find((decision) =>
    ["pending_approval", "scheduled", "failed"].includes(decision.status)
    || (
      decision.status === "applied"
      && decision.decisionKind === "non_renew"
      && decision.separationHandoffStatus !== "completed"
    ),
  ) ?? null;
  const activeLifecycle = activeTerm?.lifecycle ?? null;

  useEffect(() => {
    if (!activeTerm) return;
    const dueDate = activeLifecycle?.dueDate ?? serverToday;
    setDecisionForm((current) => ({
      ...current,
      effectiveDate: dueDate,
      nextEmploymentType: activeTerm.employmentType,
      nextTermKind: activeTerm.termKind,
      nextEffectiveUntil: activeTerm.effectiveUntil ?? "",
      nextProbationReviewDate: activeTerm.probationReviewDate ?? "",
      nextContractEndDate: activeTerm.contractEndDate ?? "",
      nextProjectName: activeTerm.projectName ?? "",
      proposedSeparationLastDay: activeTerm.contractEndDate ?? activeTerm.effectiveUntil ?? dueDate,
    }));
  }, [activeTerm?.id, activeLifecycle?.dueDate, serverToday]);

  async function mutate(url: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update employment lifecycle.");
      await load();
      await onChanged?.();
      return payload;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not update employment lifecycle.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createTerms(event: React.FormEvent) {
    event.preventDefault();
    const payload = await mutate("/api/hcm/employment-terms", "POST", {
      organizationId,
      employeeId,
      employmentType: termForm.employmentType,
      termKind: termForm.termKind,
      effectiveFrom: termForm.effectiveFrom,
      effectiveUntil: termForm.effectiveUntil || null,
      probationReviewDate: termForm.probationReviewDate || null,
      contractEndDate: termForm.contractEndDate || null,
      projectName: termForm.projectName || null,
      reason: termForm.reason,
    });
    if (payload) setShowTermForm(false);
  }

  async function actOnTerm(id: number, action: "approve" | "cancel" | "retry") {
    await mutate("/api/hcm/employment-terms", "PATCH", { id, organizationId, action });
  }

  async function createDecision(event: React.FormEvent) {
    event.preventDefault();
    if (!activeTerm) return;

    const body: Record<string, unknown> = {
      organizationId,
      employeeId,
      employmentTermId: activeTerm.id,
      decisionKind: decisionForm.decisionKind,
      effectiveDate: decisionForm.effectiveDate,
      reason: decisionForm.reason,
    };

    if (decisionForm.decisionKind === "confirm_regular") {
      body.nextEmploymentType = "Regular";
      body.nextTermKind = "regular";
    } else if (["renew_term", "extend_term", "convert_terms"].includes(decisionForm.decisionKind)) {
      body.nextEmploymentType = decisionForm.nextEmploymentType;
      body.nextTermKind = decisionForm.nextTermKind;
      body.nextEffectiveUntil = decisionForm.nextEffectiveUntil || null;
      body.nextProbationReviewDate = decisionForm.nextProbationReviewDate || null;
      body.nextContractEndDate = decisionForm.nextContractEndDate || null;
      body.nextProjectName = decisionForm.nextProjectName || null;
    } else if (decisionForm.decisionKind === "non_renew") {
      body.proposedSeparationLastDay = decisionForm.proposedSeparationLastDay;
      body.separationReason = decisionForm.separationReason;
    }

    const payload = await mutate("/api/hcm/employment-term-decisions", "POST", body);
    if (payload) setShowDecisionForm(false);
  }

  async function actOnDecision(id: number, action: "approve" | "cancel" | "retry") {
    await mutate("/api/hcm/employment-term-decisions", "PATCH", { id, organizationId, action });
  }

  const decisionOptions = activeTerm?.termKind === "probationary"
    ? ["confirm_regular", "continue_current", "convert_terms"]
    : activeTerm
      ? ["renew_term", "extend_term", "convert_terms", "non_renew", "continue_current"]
      : [];

  return (
    <section className="card" style={{ margin: "0 0 16px", boxShadow: "none" }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">EMPLOYMENT LIFECYCLE</div>
          <h2 style={{ fontSize: 14 }}>Governed terms &amp; decisions</h2>
          <p>
            Employment dates create review obligations only. Regularization, renewal, conversion, and separation require explicit governed actions.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={busy || loading}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && <div className="notice notice-amber" style={{ marginBottom: 12 }}><AlertTriangle size={15} /><span>{error}</span></div>}

      {activeTerm ? (
        <div className={activeLifecycle && ["due", "overdue"].includes(activeLifecycle.state) ? "notice notice-amber" : "notice notice-blue"} style={{ marginBottom: 12 }}>
          <CalendarClock size={15} />
          <span>
            <strong>{readable(activeTerm.termKind)} · {activeTerm.employmentType}</strong>
            {" · "}effective {activeTerm.effectiveFrom}
            {activeLifecycle?.dueDate ? ` · next lifecycle date ${activeLifecycle.dueDate}` : ""}
            {activeLifecycle?.state ? ` · ${readable(activeLifecycle.state)}` : ""}
            {activeLifecycle?.action ? ` — ${activeLifecycle.action}` : ""}
          </span>
        </div>
      ) : (
        <div className="notice notice-amber" style={{ marginBottom: 12 }}>
          <AlertTriangle size={15} />
          <span><strong>No active governed employment terms.</strong> Configure the worker's terms before relying on probation or contract-end automation.</span>
        </div>
      )}

      {openTerm && (
        <div style={{ marginBottom: 12 }}>
          <div className="payslip-line" style={{ gridTemplateColumns: "1fr auto" }}>
            <span>
              Terms request #{openTerm.id}: {readable(openTerm.termKind)} · {openTerm.employmentType}
              <em>{openTerm.reason} · requested by {openTerm.requestedBy}{openTerm.failure ? ` · ${openTerm.failure}` : ""}</em>
            </span>
            <b>{readable(openTerm.status)}</b>
          </div>
          <div className="run-actions" style={{ marginTop: 8 }}>
            {openTerm.status === "pending_approval" && (
              <button className="primary-button" disabled={busy} onClick={() => void actOnTerm(openTerm.id, "approve")}>Approve terms</button>
            )}
            {openTerm.status === "failed" && (
              <button className="primary-button" disabled={busy} onClick={() => void actOnTerm(openTerm.id, "retry")}>Retry terms</button>
            )}
            {["pending_approval", "scheduled", "failed"].includes(openTerm.status) && (
              <button className="secondary-button" disabled={busy} onClick={() => void actOnTerm(openTerm.id, "cancel")}>Cancel</button>
            )}
          </div>
          <div className="modal-note" style={{ marginTop: 8 }}>Four-eyes control applies: the requester cannot approve their own terms.</div>
        </div>
      )}

      {!activeTerm && !openTerm && !showTermForm && (
        <button className="primary-button" onClick={() => setShowTermForm(true)}>Configure employment terms</button>
      )}

      {showTermForm && (
        <form onSubmit={createTerms}>
          <div className="setting-form">
            <label>Employment type
              <input required value={termForm.employmentType} onChange={(event) => setTermForm({ ...termForm, employmentType: event.target.value })} />
            </label>
            <label>Term kind
              <select value={termForm.termKind} onChange={(event) => setTermForm({ ...termForm, termKind: event.target.value })}>
                {TERM_KINDS.map((kind) => <option key={kind} value={kind}>{readable(kind)}</option>)}
              </select>
            </label>
            <label>Effective from
              <input required type="date" value={termForm.effectiveFrom} onChange={(event) => setTermForm({ ...termForm, effectiveFrom: event.target.value })} />
            </label>
            <label>Effective until
              <input type="date" value={termForm.effectiveUntil} onChange={(event) => setTermForm({ ...termForm, effectiveUntil: event.target.value })} />
            </label>
            {termForm.termKind === "probationary" && (
              <label>Probation review date
                <input required type="date" value={termForm.probationReviewDate} onChange={(event) => setTermForm({ ...termForm, probationReviewDate: event.target.value })} />
              </label>
            )}
            {termForm.termKind === "fixed_term" && (
              <label>Contract end date
                <input required type="date" value={termForm.contractEndDate} onChange={(event) => setTermForm({ ...termForm, contractEndDate: event.target.value, effectiveUntil: event.target.value })} />
              </label>
            )}
            {termForm.termKind === "project" && (
              <label>Project name
                <input value={termForm.projectName} onChange={(event) => setTermForm({ ...termForm, projectName: event.target.value })} />
              </label>
            )}
            <label>Reason
              <input required minLength={3} value={termForm.reason} onChange={(event) => setTermForm({ ...termForm, reason: event.target.value })} />
            </label>
          </div>
          <div className="run-actions">
            <button type="button" className="secondary-button" onClick={() => setShowTermForm(false)}>Cancel</button>
            <button className="primary-button" disabled={busy}>Request terms</button>
          </div>
        </form>
      )}

      {activeTerm && relevantDecision && (
        <div style={{ marginTop: 12 }}>
          <div className="payslip-line" style={{ gridTemplateColumns: "1fr auto" }}>
            <span>
              Decision #{relevantDecision.id}: {readable(relevantDecision.decisionKind)}
              <em>
                {relevantDecision.reason} · requested by {relevantDecision.requestedBy}
                {relevantDecision.separationRecordId ? ` · Separation #${relevantDecision.separationRecordId}` : ""}
                {relevantDecision.failure ? ` · ${relevantDecision.failure}` : ""}
              </em>
            </span>
            <b>{readable(relevantDecision.status)}{relevantDecision.separationHandoffStatus !== "none" ? ` · ${readable(relevantDecision.separationHandoffStatus)}` : ""}</b>
          </div>
          <div className="run-actions" style={{ marginTop: 8 }}>
            {relevantDecision.status === "pending_approval" && (
              <button className="primary-button" disabled={busy} onClick={() => void actOnDecision(relevantDecision.id, "approve")}>Approve decision</button>
            )}
            {relevantDecision.status === "failed" && (
              <button className="primary-button" disabled={busy} onClick={() => void actOnDecision(relevantDecision.id, "retry")}>Retry decision</button>
            )}
            {["pending_approval", "scheduled", "failed"].includes(relevantDecision.status) && (
              <button className="secondary-button" disabled={busy} onClick={() => void actOnDecision(relevantDecision.id, "cancel")}>Cancel</button>
            )}
            {relevantDecision.status === "applied" && relevantDecision.decisionKind === "non_renew" && ["ready", "started"].includes(relevantDecision.separationHandoffStatus) && (
              <button className="primary-button" onClick={onOpenSeparation}>
                {relevantDecision.separationHandoffStatus === "ready" ? "Start Separation" : "Open Separation"}
              </button>
            )}
          </div>
          <div className="modal-note" style={{ marginTop: 8 }}>
            Four-eyes approval applies. Non-renewal only creates a handoff; employee separation and final pay remain owned by Separation.
          </div>
        </div>
      )}

      {activeTerm && !relevantDecision && !showDecisionForm && (
        <div className="run-actions" style={{ marginTop: 12 }}>
          <button className="primary-button" onClick={() => {
            setDecisionForm((current) => ({
              ...current,
              decisionKind: activeTerm.termKind === "probationary" ? "confirm_regular" : "continue_current",
              reason: activeTerm.termKind === "probationary"
                ? "Probation review outcome"
                : "Employment term review outcome",
            }));
            setShowDecisionForm(true);
          }}>
            Record employment decision
          </button>
        </div>
      )}

      {activeTerm && showDecisionForm && (
        <form onSubmit={createDecision} style={{ marginTop: 12 }}>
          <div className="setting-form">
            <label>Decision
              <select value={decisionForm.decisionKind} onChange={(event) => setDecisionForm({ ...decisionForm, decisionKind: event.target.value })}>
                {decisionOptions.map((kind) => <option key={kind} value={kind}>{readable(kind)}</option>)}
              </select>
            </label>
            <label>Effective date
              <input required type="date" value={decisionForm.effectiveDate} onChange={(event) => setDecisionForm({ ...decisionForm, effectiveDate: event.target.value })} />
            </label>
            <label>Reason
              <input required minLength={3} value={decisionForm.reason} onChange={(event) => setDecisionForm({ ...decisionForm, reason: event.target.value })} />
            </label>

            {["renew_term", "extend_term", "convert_terms"].includes(decisionForm.decisionKind) && (
              <>
                <label>Successor employment type
                  <input required value={decisionForm.nextEmploymentType} onChange={(event) => setDecisionForm({ ...decisionForm, nextEmploymentType: event.target.value })} />
                </label>
                <label>Successor term kind
                  <select value={decisionForm.nextTermKind} onChange={(event) => setDecisionForm({ ...decisionForm, nextTermKind: event.target.value })}>
                    {TERM_KINDS.map((kind) => <option key={kind} value={kind}>{readable(kind)}</option>)}
                  </select>
                </label>
                {decisionForm.nextTermKind === "probationary" && (
                  <label>Next probation review date
                    <input required type="date" value={decisionForm.nextProbationReviewDate} onChange={(event) => setDecisionForm({ ...decisionForm, nextProbationReviewDate: event.target.value })} />
                  </label>
                )}
                {decisionForm.nextTermKind === "fixed_term" && (
                  <label>Next contract end date
                    <input required type="date" value={decisionForm.nextContractEndDate} onChange={(event) => setDecisionForm({
                      ...decisionForm,
                      nextContractEndDate: event.target.value,
                      nextEffectiveUntil: event.target.value,
                    })} />
                  </label>
                )}
                {decisionForm.nextTermKind === "project" && (
                  <label>Next project name
                    <input value={decisionForm.nextProjectName} onChange={(event) => setDecisionForm({ ...decisionForm, nextProjectName: event.target.value })} />
                  </label>
                )}
              </>
            )}

            {decisionForm.decisionKind === "non_renew" && (
              <>
                <label>Proposed last day
                  <input required type="date" value={decisionForm.proposedSeparationLastDay} onChange={(event) => setDecisionForm({ ...decisionForm, proposedSeparationLastDay: event.target.value })} />
                </label>
                <label>Separation reason
                  <input required value={decisionForm.separationReason} onChange={(event) => setDecisionForm({ ...decisionForm, separationReason: event.target.value })} />
                </label>
              </>
            )}
          </div>
          <div className="run-actions">
            <button type="button" className="secondary-button" onClick={() => setShowDecisionForm(false)}>Cancel</button>
            <button className="primary-button" disabled={busy}>Request decision</button>
          </div>
        </form>
      )}

      {!loading && activeTerm && !openTerm && !relevantDecision && activeLifecycle?.state === "future" && (
        <div className="notice notice-green" style={{ marginTop: 12 }}>
          <CheckCircle2 size={15} />
          <span>No employment lifecycle action is due inside the 30-day review window.</span>
        </div>
      )}

      <div className="modal-note" style={{ marginTop: 12 }}>
        <ShieldCheck size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />
        PayrollPH never auto-regularizes, never auto-renews, and never auto-separates a worker from a date alone.
      </div>
    </section>
  );
}

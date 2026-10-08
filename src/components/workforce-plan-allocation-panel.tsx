"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDollarSign, Send, ShieldCheck, UsersRound, XCircle } from "lucide-react";

type Plan = {
  id: number;
  name: string;
  budget: string;
  status: string;
};

type OrgUnit = {
  id: number;
  name: string;
  code: string;
  active: boolean;
};

type Allocation = {
  id: number;
  planId: number;
  orgUnitId: number;
  orgUnitName: string;
  orgUnitCode: string | null;
  headcountCeiling: number;
  annualBudgetCeiling: string;
  notes: string | null;
  updatedAt: string;
};

type Submission = {
  id: number;
  planId: number;
  allocationId: number;
  orgUnitId: number;
  orgUnitName: string;
  orgUnitCode: string | null;
  version: number;
  requestedHeadcount: number;
  requestedAnnualBudget: string;
  rationale: string;
  status: string;
  decisionNote: string | null;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  canSubmit: boolean;
  canDecide: boolean;
};

type AllocationAccess = {
  role: string;
  companyWide: boolean;
  orgUnitId: number | null;
  canManageAllocations: boolean;
  canDecideSubmissions: boolean;
};

const peso = (value: number | string) =>
  `₱${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

function statusClass(status: string) {
  if (status === "accepted") return "status status-verified";
  if (status === "rejected") return "status status-rejected";
  return "status";
}

export function WorkforcePlanAllocationPanel({
  organizationId,
  plans,
  orgUnits,
  setNotice,
}: {
  organizationId: number;
  plans: Plan[];
  orgUnits: OrgUnit[];
  setNotice: (message: string) => void;
}) {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [access, setAccess] = useState<AllocationAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAllocation, setSavingAllocation] = useState(false);
  const [savingSubmission, setSavingSubmission] = useState(false);
  const [actingSubmissionId, setActingSubmissionId] = useState<number | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [allocationForm, setAllocationForm] = useState({
    orgUnitId: "",
    headcountCeiling: "",
    annualBudgetCeiling: "",
    notes: "",
  });
  const [submissionForm, setSubmissionForm] = useState({
    allocationId: "",
    requestedHeadcount: "",
    requestedAnnualBudget: "",
    rationale: "",
  });
  const [decisionNotes, setDecisionNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workforce-planning/allocations?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not load workforce plan allocations.");
        return;
      }
      setAllocations(payload.allocations ?? []);
      setSubmissions(payload.submissions ?? []);
      setAccess(payload.access ?? null);
    } catch {
      setNotice("Could not reach workforce allocation planning.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedPlanId && plans.length) {
      setSelectedPlanId(String(plans[0].id));
    }
  }, [plans, selectedPlanId]);

  const selectedPlan = plans.find((plan) => plan.id === Number(selectedPlanId)) ?? null;
  const planAllocations = useMemo(
    () => allocations.filter((allocation) => allocation.planId === Number(selectedPlanId)),
    [allocations, selectedPlanId],
  );
  const planSubmissions = useMemo(
    () => submissions.filter((submission) => submission.planId === Number(selectedPlanId)),
    [submissions, selectedPlanId],
  );
  const allocatedBudget = planAllocations.reduce(
    (sum, allocation) => sum + Number(allocation.annualBudgetCeiling),
    0,
  );
  const allocatedHeadcount = planAllocations.reduce(
    (sum, allocation) => sum + allocation.headcountCeiling,
    0,
  );
  const selectedAllocation = planAllocations.find(
    (allocation) => allocation.id === Number(submissionForm.allocationId),
  ) ?? null;
  const acceptedByAllocation = useMemo(() => {
    const map = new Map<number, Submission>();
    for (const submission of planSubmissions) {
      if (submission.status === "accepted" && !map.has(submission.allocationId)) {
        map.set(submission.allocationId, submission);
      }
    }
    return map;
  }, [planSubmissions]);

  useEffect(() => {
    if (
      submissionForm.allocationId
      && !planAllocations.some((allocation) => allocation.id === Number(submissionForm.allocationId))
    ) {
      setSubmissionForm((current) => ({ ...current, allocationId: "" }));
    }
  }, [planAllocations, submissionForm.allocationId]);

  async function saveAllocation(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPlan) {
      setNotice("Select a workforce plan first.");
      return;
    }
    setSavingAllocation(true);
    try {
      const response = await fetch("/api/workforce-planning/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          entityType: "allocation",
          planId: selectedPlan.id,
          orgUnitId: Number(allocationForm.orgUnitId),
          headcountCeiling: Number(allocationForm.headcountCeiling),
          annualBudgetCeiling: Number(allocationForm.annualBudgetCeiling),
          notes: allocationForm.notes,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not save workforce allocation.");
        return;
      }
      setAllocationForm({ orgUnitId: "", headcountCeiling: "", annualBudgetCeiling: "", notes: "" });
      await load();
      setNotice("Top-down workforce allocation saved.");
    } catch {
      setNotice("Could not reach workforce allocation management.");
    } finally {
      setSavingAllocation(false);
    }
  }

  async function createSubmission(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAllocation) {
      setNotice("Select an org-unit allocation first.");
      return;
    }
    setSavingSubmission(true);
    try {
      const response = await fetch("/api/workforce-planning/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          entityType: "submission",
          allocationId: selectedAllocation.id,
          requestedHeadcount: Number(submissionForm.requestedHeadcount),
          requestedAnnualBudget: Number(submissionForm.requestedAnnualBudget),
          rationale: submissionForm.rationale,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not create manager workforce request.");
        return;
      }
      setSubmissionForm({
        allocationId: submissionForm.allocationId,
        requestedHeadcount: "",
        requestedAnnualBudget: "",
        rationale: "",
      });
      await load();
      setNotice(`Manager workforce request v${payload.submission?.version ?? ""} saved as draft.`);
    } catch {
      setNotice("Could not reach manager workforce request management.");
    } finally {
      setSavingSubmission(false);
    }
  }

  async function submissionAction(
    submissionId: number,
    action: "submit" | "accept" | "reject",
  ) {
    setActingSubmissionId(submissionId);
    try {
      const response = await fetch("/api/workforce-planning/allocations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          action,
          decisionNote: decisionNotes[submissionId] ?? "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not update manager workforce request.");
        return;
      }
      await load();
      setNotice(
        action === "submit"
          ? "Manager workforce request submitted for plan-owner review."
          : action === "accept"
            ? "Manager workforce request accepted into planning evidence."
            : "Manager workforce request rejected with decision evidence.",
      );
    } catch {
      setNotice("Could not reach manager workforce request management.");
    } finally {
      setActingSubmissionId(null);
    }
  }

  if (loading && !access) {
    return (
      <article className="card" style={{ marginBottom: 16 }}>
        <div className="empty-state">Loading workforce allocations...</div>
      </article>
    );
  }

  return (
    <article className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">WORKFORCE PLANNING 2.0</div>
          <h2>Top-down allocation &amp; manager submissions</h2>
          <p>
            Plan owners allocate headcount and annual budget by organization unit.
            Managers submit requests within those ceilings. Accepted requests remain planning evidence;
            they do not create positions, schedules, or payroll changes.
          </p>
        </div>
      </div>

      <div className="setting-form" style={{ marginBottom: 16 }}>
        <label>
          Workforce plan
          <select value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>
            <option value="">Select plan</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} · {plan.status}
              </option>
            ))}
          </select>
        </label>
        {selectedPlan && (
          <>
            <div className="notice notice-slate" style={{ margin: 0 }}>
              <CircleDollarSign size={15} />
              <span>
                Plan budget {peso(selectedPlan.budget)} · allocated {peso(allocatedBudget)} · remaining{" "}
                {peso(Math.max(0, Number(selectedPlan.budget) - allocatedBudget))}
              </span>
            </div>
            <div className="notice notice-slate" style={{ margin: 0 }}>
              <UsersRound size={15} />
              <span>{allocatedHeadcount} headcount allocated across {planAllocations.length} org unit(s)</span>
            </div>
          </>
        )}
      </div>

      {access?.canManageAllocations && selectedPlan && (
        <form onSubmit={saveAllocation} className="card" style={{ padding: 14, boxShadow: "none", marginBottom: 16 }}>
          <div className="card-kicker">PLAN OWNER · TOP-DOWN</div>
          <div className="setting-form">
            <label>
              Organization unit
              <select
                required
                value={allocationForm.orgUnitId}
                onChange={(event) => {
                  const nextOrgUnitId = event.target.value;
                  const existing = planAllocations.find((row) => row.orgUnitId === Number(nextOrgUnitId));
                  setAllocationForm({
                    orgUnitId: nextOrgUnitId,
                    headcountCeiling: existing ? String(existing.headcountCeiling) : "",
                    annualBudgetCeiling: existing ? String(existing.annualBudgetCeiling) : "",
                    notes: existing?.notes ?? "",
                  });
                }}
              >
                <option value="">Select org unit</option>
                {orgUnits.filter((unit) => unit.active).map((unit) => (
                  <option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>
                ))}
              </select>
            </label>
            <label>
              Headcount ceiling
              <input
                required
                type="number"
                min="0"
                step="1"
                value={allocationForm.headcountCeiling}
                onChange={(event) => setAllocationForm({ ...allocationForm, headcountCeiling: event.target.value })}
              />
            </label>
            <label>
              Annual budget ceiling
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={allocationForm.annualBudgetCeiling}
                onChange={(event) => setAllocationForm({ ...allocationForm, annualBudgetCeiling: event.target.value })}
              />
            </label>
            <label>
              Allocation note
              <input
                value={allocationForm.notes}
                onChange={(event) => setAllocationForm({ ...allocationForm, notes: event.target.value })}
                placeholder="Growth target, operating constraint, or approved envelope"
              />
            </label>
            <button className="primary-button" disabled={savingAllocation}>
              <ShieldCheck size={14} /> {savingAllocation ? "Saving..." : "Save allocation"}
            </button>
          </div>
        </form>
      )}

      {selectedPlan && planAllocations.length > 0 && (
        <form onSubmit={createSubmission} className="card" style={{ padding: 14, boxShadow: "none", marginBottom: 16 }}>
          <div className="card-kicker">MANAGER · BOTTOM-UP</div>
          <div className="setting-form">
            <label>
              Org-unit allocation
              <select
                required
                value={submissionForm.allocationId}
                onChange={(event) => setSubmissionForm({ ...submissionForm, allocationId: event.target.value })}
              >
                <option value="">Select allocation</option>
                {planAllocations.map((allocation) => (
                  <option key={allocation.id} value={allocation.id}>
                    {allocation.orgUnitCode ? `${allocation.orgUnitCode} · ` : ""}{allocation.orgUnitName}
                    {" · "}{allocation.headcountCeiling} HC · {peso(allocation.annualBudgetCeiling)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Requested headcount
              <input
                required
                type="number"
                min="0"
                max={selectedAllocation?.headcountCeiling}
                step="1"
                value={submissionForm.requestedHeadcount}
                onChange={(event) => setSubmissionForm({ ...submissionForm, requestedHeadcount: event.target.value })}
              />
            </label>
            <label>
              Requested annual budget
              <input
                required
                type="number"
                min="0"
                max={selectedAllocation ? Number(selectedAllocation.annualBudgetCeiling) : undefined}
                step="0.01"
                value={submissionForm.requestedAnnualBudget}
                onChange={(event) => setSubmissionForm({ ...submissionForm, requestedAnnualBudget: event.target.value })}
              />
            </label>
            <label>
              Business rationale
              <input
                required
                minLength={5}
                value={submissionForm.rationale}
                onChange={(event) => setSubmissionForm({ ...submissionForm, rationale: event.target.value })}
                placeholder="Demand, vacancy, service level, or operating reason"
              />
            </label>
            <button className="secondary-button" disabled={savingSubmission || !selectedAllocation}>
              <UsersRound size={14} /> {savingSubmission ? "Saving..." : "Save manager draft"}
            </button>
          </div>
        </form>
      )}

      <div className="data-table-wrap" style={{ marginBottom: 16 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>ORG UNIT</th>
              <th>TOP-DOWN CEILING</th>
              <th>ACCEPTED REQUEST</th>
              <th>NOTE</th>
            </tr>
          </thead>
          <tbody>
            {planAllocations.map((allocation) => {
              const accepted = acceptedByAllocation.get(allocation.id);
              return (
                <tr key={allocation.id}>
                  <td><strong>{allocation.orgUnitName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{allocation.orgUnitCode ?? "—"}</small></td>
                  <td><strong>{allocation.headcountCeiling} HC · {peso(allocation.annualBudgetCeiling)}</strong></td>
                  <td>
                    {accepted
                      ? <><strong>{accepted.requestedHeadcount} HC · {peso(accepted.requestedAnnualBudget)}</strong><small style={{ display: "block", color: "var(--muted)" }}>v{accepted.version} accepted</small></>
                      : "No accepted request"}
                  </td>
                  <td>{allocation.notes ?? "—"}</td>
                </tr>
              );
            })}
            {planAllocations.length === 0 && (
              <tr><td colSpan={4}><div className="empty-state">No org-unit allocations for this plan yet.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>MANAGER REQUEST</th>
              <th>REQUEST</th>
              <th>RATIONALE</th>
              <th>STATUS</th>
              <th className="right">ACTION</th>
            </tr>
          </thead>
          <tbody>
            {planSubmissions.map((submission) => (
              <tr key={submission.id}>
                <td>
                  <strong>{submission.orgUnitName} · v{submission.version}</strong>
                  <small style={{ display: "block", color: "var(--muted)" }}>
                    {new Date(submission.createdAt).toLocaleDateString("en-PH")}
                  </small>
                </td>
                <td>
                  <strong>{submission.requestedHeadcount} HC · {peso(submission.requestedAnnualBudget)}</strong>
                </td>
                <td>
                  {submission.rationale}
                  {submission.decisionNote && (
                    <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                      Decision: {submission.decisionNote}
                    </small>
                  )}
                </td>
                <td><span className={statusClass(submission.status)}>{submission.status}</span></td>
                <td className="right">
                  <div className="run-actions" style={{ justifyContent: "flex-end" }}>
                    {submission.canSubmit && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={actingSubmissionId === submission.id}
                        onClick={() => void submissionAction(submission.id, "submit")}
                      >
                        <Send size={14} /> Submit
                      </button>
                    )}
                    {submission.canDecide && (
                      <>
                        <input
                          aria-label={`Decision note for request ${submission.id}`}
                          value={decisionNotes[submission.id] ?? ""}
                          onChange={(event) => setDecisionNotes({
                            ...decisionNotes,
                            [submission.id]: event.target.value,
                          })}
                          placeholder="Decision note"
                          style={{ minWidth: 150 }}
                        />
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={actingSubmissionId === submission.id}
                          onClick={() => void submissionAction(submission.id, "accept")}
                        >
                          <CheckCircle2 size={14} /> Accept
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={actingSubmissionId === submission.id}
                          onClick={() => void submissionAction(submission.id, "reject")}
                        >
                          <XCircle size={14} /> Reject
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {planSubmissions.length === 0 && (
              <tr><td colSpan={5}><div className="empty-state">No manager submissions for this plan yet.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

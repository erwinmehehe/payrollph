"use client";

import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { GovernmentLoanRemittancePanel as LegacyPanel } from "./government-loan-remittance-panel-legacy";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Landmark, RefreshCw, ShieldCheck } from "lucide-react";
import { isConfirmedGovernmentLoanMutation, isVerifiedGovernmentLoanRemittanceRead, type GovernmentLoanRead } from "@/lib/government-loan-remittance-read";

type Agency = "SSS" | "Pag-IBIG";

type Batch = {
  id: number;
  agency: Agency;
  applicableMonth: string;
  dueDate: string;
  status: string;
  displayStatus: string;
  employeeCount: number;
  loanCount: number;
  expectedTotal: string;
  amountPaid: string | null;
  pendingPostingCount: number;
  exceptionCount: number;
};

type Member = {
  id: number;
  batchId: number;
  employeeNo: string;
  loanType: string;
  loanReferenceNo: string;
  deductedAmount: string;
  postingStatus: string;
  postedAmount: string | null;
  postingReference: string | null;
  exceptionNote: string | null;
};

const peso = (value: string | number) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function previousMonth() {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return month.toISOString().slice(0, 7);
}

export function GovernmentLoanRemittancePanel(props: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  if (!criticalReleaseFlagEnabled("governmentLoanRemittanceUi", {
    NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED:
      process.env.NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED,
  })) return <LegacyPanel {...props} />;
  // Employer scope is tenant-private. Remount on a new organizationId so no
  // batch, member or posting state from the previous employer can render.
  return <GovernmentLoanRemittancePanelEmployerScope key={props.organizationId} {...props} />;
}

type LegalEmployerOption = {
  id: number;
  code: string | null;
  displayName: string;
  active: true;
  primaryEntity: boolean;
};

// A foreign or partial legal-employer directory is never an implicit choice.
function parseAuthorizedLegalEmployers(value: unknown, organizationId: number): LegalEmployerOption[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.organizationId !== organizationId || !Array.isArray(body.legalEntities) ||
      body.legalEntities.length > 1000) return null;
  const ids = new Set<number>();
  const result: LegalEmployerOption[] = [];
  for (const value of body.legalEntities) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id <= 0 ||
        ids.has(row.id) || typeof row.displayName !== "string" || !row.displayName.trim() ||
        !(row.code === null || typeof row.code === "string") ||
        typeof row.primaryEntity !== "boolean" || row.active !== true) return null;
    ids.add(row.id);
    result.push({
      id: row.id, code: row.code as string | null, displayName: row.displayName,
      primaryEntity: row.primaryEntity, active: true,
    });
  }
  return result;
}

function GovernmentLoanRemittancePanelEmployerScope({
  organizationId, setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [legalEmployers, setLegalEmployers] = useState<LegalEmployerOption[]>([]);
  const [selectedLegalEntityId, setSelectedLegalEntityId] = useState<number | null>(null);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeError, setScopeError] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);

  const loadEmployers = useCallback(async (signal?: AbortSignal) => {
    setScopeLoading(true);
    setScopeError("");
    setLegalEmployers([]);
    setSelectedLegalEntityId(null);
    try {
      const response = await fetch(
        "/api/legal-entities?organizationId=" + organizationId + "&mode=selector",
        { cache: "no-store", signal },
      );
      if (signal?.aborted) return;
      if (!response.ok) throw new Error("Authorized legal employers are unavailable.");
      const body: unknown = await response.json();
      const entries = parseAuthorizedLegalEmployers(body, organizationId);
      if (!entries || entries.length === 0)
        throw new Error("No verified active legal employer is available.");
      if (signal?.aborted) return;
      setLegalEmployers(entries);
      // Never choose an implicit legal employer when more than one is accessible.
      setSelectedLegalEntityId(entries.length === 1 ? entries[0].id : null);
    } catch {
      if (!signal?.aborted) setScopeError(
        "Legal employer access could not be verified. No loan records or payment actions are available.",
      );
    } finally {
      if (!signal?.aborted) setScopeLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadEmployers(controller.signal);
    });
    return () => controller.abort();
  }, [loadEmployers]);

  if (scopeLoading) return <div role="status" className="notice notice-amber">
    Checking authorized legal employers before loading government loan remittances…
  </div>;
  if (scopeError) return <div role="alert" className="notice notice-amber" style={{ display: "grid", gap: 8 }}>
    {scopeError}
    <button className="secondary-button" type="button" onClick={() => void loadEmployers()}>
      Retry legal employer access
    </button>
  </div>;
  return (
    <div data-government-loan-employer-scope style={{ display: "grid", gap: 10 }}>
      {legalEmployers.length > 1 ? (
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Legal employer for government loan remittances</span>
          <select aria-label="Legal employer for government loan remittances"
            value={selectedLegalEntityId ?? ""}
            disabled={mutationBusy}
            onChange={(event) => {
              const id = Number(event.target.value);
              setSelectedLegalEntityId(legalEmployers.some(entity => entity.id === id) ? id : null);
            }}>
            <option value="">Select a legal employer</option>
            {legalEmployers.map(entity => (
              <option key={entity.id} value={entity.id}>
                {entity.displayName}{entity.code ? " (" + entity.code + ")" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>Legal employer: <strong>{legalEmployers[0].displayName}</strong></p>
      )}
      {selectedLegalEntityId === null ? (
        <p role="status">Choose an authorized legal employer before viewing or recording loan remittances.</p>
      ) : (
        <GovernmentLoanRemittancePanelContent
          key={organizationId + ":" + selectedLegalEntityId}
          organizationId={organizationId}
          legalEntityId={selectedLegalEntityId}
          setNotice={setNotice}
          onMutationBusyChange={setMutationBusy}
        />
      )}
    </div>
  );
}

function GovernmentLoanRemittancePanelContent({
  organizationId,
  legalEntityId,
  setNotice,
  onMutationBusyChange,
}: {
  organizationId: number;
  legalEntityId: number;
  setNotice: (message: string) => void;
  onMutationBusyChange: (busy: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<GovernmentLoanRead | null>(null);
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(true);
  const members: Member[] = snapshot?.members ?? [];
  const [month, setMonth] = useState(previousMonth());
  const [busy, setBusy] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [paymentBatchId, setPaymentBatchId] = useState<number | null>(null);
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [agencyAcknowledgementReference, setAgencyAcknowledgementReference] = useState("");
  const [paymentVarianceNote, setPaymentVarianceNote] = useState("");
  const [postingMemberId, setPostingMemberId] = useState<number | null>(null);
  const [postingAmount, setPostingAmount] = useState("");
  const [postingReference, setPostingReference] = useState("");
  const [exceptionNote, setExceptionNote] = useState("");

  const load = useCallback(async (signal?: AbortSignal): Promise<GovernmentLoanRead | null> => {
    setReading(true);
    setSnapshot(null);
    setReadError("");
    try {
      const response = await fetch(
        "/api/compliance/government-loan-remittances?organizationId=" + organizationId + "&legalEntityId=" + legalEntityId,
        { cache: "no-store", signal },
      );
      if (signal?.aborted) return null;
      if (response.status === 403) {
        setForbidden(true);
        setReadError("Access to this employer's government loan records is unavailable.");
        return null;
      }
      if (!response.ok) throw new Error("Government loan remittances are unavailable.");
      const body: unknown = await response.json();
      if (!isVerifiedGovernmentLoanRemittanceRead(body, organizationId) ||
          body.legalEntityId !== legalEntityId) {
        throw new Error("Government loan totals or member records are incomplete or from another employer.");
      }
      if (signal?.aborted) return null;
      setForbidden(false);
      setSnapshot(body);
      return body;
    } catch {
      if (!signal?.aborted) setReadError("Government loan evidence is unavailable or could not be verified. Retry before taking action.");
      return null;
    } finally {
      if (!signal?.aborted) setReading(false);
    }
  }, [organizationId, legalEntityId]);

  useEffect(() => {
    const controller = new AbortController();
    // The request runs after effect setup, never in its synchronous phase.
    // Strict Mode cleanup can cancel this scheduled read before it starts.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, setNotice]);

  const monthBatches = useMemo(
    () => (snapshot?.batches ?? []).filter((batch) => batch.applicableMonth === month),
    [snapshot, month],
  );

  async function mutate(action: string, payload: Record<string, unknown>, success: string) {
    if (!snapshot || reading || busy !== null) return false;
    setBusy(action);
    onMutationBusyChange(true);
    try {
      const response = await fetch("/api/compliance/government-loan-remittances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, legalEntityId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Government loan remittance action failed.");
      // A successful POST may have committed even if the next GET is stale or
      // unavailable. Never report success until its exact row/revision appears.
      const refreshed = await load();
      if (!refreshed || !isConfirmedGovernmentLoanMutation(action, payload, body, refreshed)) {
        const uncertain = "This action may already have been recorded, but the updated employer record could not be confirmed. Check the current batch and agency posting evidence before retrying.";
        setSnapshot(null);
        setReadError(uncertain);
        setNotice(uncertain);
        return false;
      }
      setNotice(success);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Government loan remittance action failed.");
      return false;
    } finally {
      setBusy(null);
      onMutationBusyChange(false);
    }
  }

  async function createBatch(agency: Agency) {
    await mutate(
      "create_batch",
      { agency, applicableMonth: month },
      `${agency} loan remittance liability snapshotted from released payroll.`,
    );
  }

  async function recordPayment(batch: Batch) {
    const ok = await mutate("record_payment", {
      batchId: batch.id,
      amountPaid: Number(amountPaid || batch.expectedTotal),
      paymentReference,
      agencyAcknowledgementReference,
      paymentVarianceNote,
    }, `${batch.agency} loan remittance payment recorded. Member posting still needs reconciliation.`);
    if (ok) {
      setPaymentBatchId(null);
      setAmountPaid("");
      setPaymentReference("");
      setAgencyAcknowledgementReference("");
      setPaymentVarianceNote("");
    }
  }

  async function confirmPosting(member: Member) {
    const ok = await mutate("confirm_member_posting", {
      memberId: member.id,
      postedAmount: Number(postingAmount),
      postingReference,
    }, `${member.employeeNo} loan posting confirmed.`);
    if (ok) {
      setPostingMemberId(null);
      setPostingAmount("");
      setPostingReference("");
      setExceptionNote("");
    }
  }

  async function markException(member: Member) {
    const ok = await mutate("mark_member_exception", {
      memberId: member.id,
      exceptionNote,
    }, `${member.employeeNo} loan posting flagged for follow-up.`);
    if (ok) {
      setPostingMemberId(null);
      setPostingAmount("");
      setPostingReference("");
      setExceptionNote("");
    }
  }

  if (forbidden) return (
    <div role="alert" className="notice notice-amber" style={{ display: "grid", gap: 8 }}>
      Government loan records are unavailable for this employer. No status or payment actions can be shown.
      <button type="button" className="secondary-button" disabled={reading || busy !== null}
        onClick={() => void load()}>Retry employer access</button>
    </div>
  );

  return (
    <article className="card" style={{ marginTop: 18 }} data-government-loan-remittance>
      <div className="card-header">
        <div>
          <div className="card-kicker">PH GOVERNMENT LOAN REMITTANCE</div>
          <h2>Payroll deduction is not proof of agency payment.</h2>
          <p>
            Reconcile SSS Salary/Calamity Loans and Pag-IBIG MPL/Calamity Loans from released payroll to employer payment and member posting.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={busy !== null || reading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
        {reading && <p role="status">Verifying employer-scoped remittance and member evidence…</p>}
        {readError && <div role="alert" className="notice notice-amber">
          <AlertTriangle size={15} /> {readError}
          <button className="secondary-button" type="button" disabled={reading || busy !== null} onClick={() => void load()}>Retry evidence read</button>
        </div>}
        {snapshot && monthBatches.length === 0 && (
          <p role="status">No remittance batch is recorded for this month. This is not proof that loan liabilities are zero.</p>
        )}
        <div className="notice notice-amber" style={{ margin: 0 }}>
          <AlertTriangle size={15} />
          <span>
            SSS and Pag-IBIG loan deductions stay unreconciled until employer payment is recorded and each employee loan posting is confirmed.
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <label className="field" style={{ minWidth: 180 }}>
            <span>Applicable month</span>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          {(["SSS", "Pag-IBIG"] as Agency[]).map((agency) => (
            <button
              key={agency}
              className="secondary-button"
              disabled={!snapshot || reading || busy !== null || monthBatches.some((batch) => batch.agency === agency)}
              onClick={() => void createBatch(agency)}
            >
              <Landmark size={14} />
              {monthBatches.some((batch) => batch.agency === agency) ? `${agency} created` : `Open ${agency} loan remittance`}
            </button>
          ))}
        </div>

        {monthBatches.map((batch) => {
          const rows = members.filter((member) => member.batchId === batch.id);
          const paymentOpen = paymentBatchId === batch.id;
          return (
            <section key={batch.id} className="leave-request" style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong>{batch.agency} loans · {batch.applicableMonth}</strong>
                  <p style={{ margin: "3px 0 0" }}>
                    Control due {batch.dueDate} · {batch.employeeCount} employees · {batch.loanCount} loans · {peso(batch.expectedTotal)}
                  </p>
                </div>
                <span className={batch.displayStatus === "overdue" || batch.status === "exception" ? "status-pill danger" : "status-pill"}>
                  {batch.displayStatus}
                </span>
              </div>

              <div className="run-stats" style={{ margin: 0 }}>
                <div><span>Payroll-deducted</span><strong>{peso(batch.expectedTotal)}</strong></div>
                <div><span>Posting left</span><strong>{batch.pendingPostingCount}</strong><small>loan records</small></div>
                <div><span>Exceptions</span><strong>{batch.exceptionCount}</strong><small>need follow-up</small></div>
              </div>

              {batch.status === "open" && (
                <>
                  <button className="primary-button" onClick={() => setPaymentBatchId(paymentOpen ? null : batch.id)}>
                    <ShieldCheck size={14} /> Record agency payment
                  </button>
                  {paymentOpen && (
                    <div className="setting-form">
                      <label>Amount paid
                        <input type="number" step="0.01" min={batch.expectedTotal} value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder={batch.expectedTotal} />
                      </label>
                      <label>{batch.agency === "SSS" ? "Loan PRN / payment reference" : "PIN / payment reference"}
                        <input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
                      </label>
                      <label>{batch.agency === "SSS" ? "LCL / SSS acknowledgement" : "Pag-IBIG acknowledgement"}
                        <input value={agencyAcknowledgementReference} onChange={(e) => setAgencyAcknowledgementReference(e.target.value)} />
                      </label>
                      <label>Penalty / interest note
                        <input value={paymentVarianceNote} onChange={(e) => setPaymentVarianceNote(e.target.value)} placeholder="Required only if payment is above payroll deductions" />
                      </label>
                      <div style={{ alignSelf: "end" }}>
                        <button className="primary-button" disabled={busy !== null} onClick={() => void recordPayment(batch)}>
                          Record payment
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {batch.status !== "open" && rows.length > 0 && (
                <div className="data-table-wrap slim-scroll">
                  <table className="data-table">
                    <thead>
                      <tr><th>Employee / loan</th><th>Deducted</th><th>Agency posting</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((member) => (
                        <tr key={member.id}>
                          <td>
                            <strong>{member.employeeNo} · {member.loanType}</strong>
                            <div className="id">{member.loanReferenceNo}</div>
                          </td>
                          <td className="num">{peso(member.deductedAmount)}</td>
                          <td>
                            {member.postingStatus === "confirmed" ? (
                              <div>
                                <span className="green-number"><CheckCircle2 size={13} /> Confirmed</span>
                                <div className="id">{peso(member.postedAmount ?? member.deductedAmount)} · {member.postingReference}</div>
                              </div>
                            ) : postingMemberId === member.id ? (
                              <div style={{ display: "grid", gap: 6 }}>
                                <input type="number" min="0" step="0.01" value={postingAmount} onChange={(e) => setPostingAmount(e.target.value)} placeholder={member.deductedAmount} />
                                <input value={postingReference} onChange={(e) => setPostingReference(e.target.value)} placeholder="Agency loan posting reference" />
                                <input value={exceptionNote} onChange={(e) => setExceptionNote(e.target.value)} placeholder="Or explain missing / incorrect posting" />
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <button className="secondary-button" disabled={!postingReference.trim() || !postingAmount || busy !== null} onClick={() => void confirmPosting(member)}>Confirm posted</button>
                                  <button className="secondary-button" disabled={!exceptionNote.trim() || busy !== null} onClick={() => void markException(member)}>Flag exception</button>
                                </div>
                              </div>
                            ) : (
                              <button className="secondary-button" onClick={() => {
                                setPostingMemberId(member.id);
                                setPostingAmount(member.deductedAmount);
                                setPostingReference("");
                                setExceptionNote(member.exceptionNote ?? "");
                              }}>
                                {member.postingStatus === "exception" ? "Resolve exception" : "Reconcile loan"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </article>
  );
}

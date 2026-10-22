"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Landmark, RefreshCw, ShieldCheck } from "lucide-react";
import { confirmedGovernmentLoanMutation, readVerifiedGovernmentLoanRemittances, type VerifiedGovernmentLoanBatch, type VerifiedGovernmentLoanMember } from "@/lib/government-loan-remittance-read";

type Agency = "SSS" | "Pag-IBIG";

type Batch = VerifiedGovernmentLoanBatch;
type Member = VerifiedGovernmentLoanMember;

const peso = (value: string | number) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function previousMonth() {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return month.toISOString().slice(0, 7);
}

type PanelProps = {
  organizationId: number;
  setNotice: (message: string) => void;
};
type LegalEmployerOption = { id: number; displayName: string; active: true };

export function GovernmentLoanRemittancePanel(props: PanelProps) {
  // Re-mount all evidence and draft actions when either employer identity changes.
  return <GovernmentLoanLegalEmployerSelector key={props.organizationId} {...props} />;
}

function GovernmentLoanLegalEmployerSelector(props: PanelProps) {
  const [options, setOptions] = useState<LegalEmployerOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">("loading");
  const [error, setError] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);

  const refreshSelector = useCallback(async (signal?: AbortSignal) => {
    setPhase("loading");
    setError("");
    try {
      const response = await fetch(
        "/api/legal-entities?organizationId=" + props.organizationId + "&mode=selector",
        { cache: "no-store", signal },
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data !== "object" || Array.isArray(data))
        throw Error("Legal-employer selector unavailable.");
      const body = data as Record<string, unknown>;
      if (body.organizationId !== props.organizationId ||
          !Array.isArray(body.legalEntities) || body.legalEntities.length === 0 ||
          body.legalEntities.length > 100 ||
          !body.legalEntities.every((item: unknown) =>
            item !== null && typeof item === "object" && !Array.isArray(item) &&
            Number.isSafeInteger((item as LegalEmployerOption).id) &&
            (item as LegalEmployerOption).id > 0 &&
            (item as LegalEmployerOption).active === true &&
            typeof (item as LegalEmployerOption).displayName === "string" &&
            (item as LegalEmployerOption).displayName.trim().length > 0)) {
        throw Error("Legal-employer selector returned an incomplete authorized scope.");
      }
      const entities = body.legalEntities as LegalEmployerOption[];
      if (new Set(entities.map((item) => item.id)).size !== entities.length)
        throw Error("Legal-employer selector returned duplicate IDs.");
      if (signal?.aborted) return;
      setOptions(entities);
      setSelectedId(entities.length === 1 ? entities[0].id : null);
      setPhase("ready");
    } catch (caught) {
      if (signal?.aborted) return;
      setOptions([]);
      setSelectedId(null);
      setPhase("unavailable");
      setError(caught instanceof Error ? caught.message : "Legal-employer selector unavailable.");
    }
  }, [props.organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void refreshSelector(controller.signal);
    });
    return () => controller.abort();
  }, [refreshSelector]);

  return (
    <div data-government-loan-legal-employer>
      {phase === "loading" && <div className="notice notice-amber" role="status">Verifying authorized legal employers…</div>}
      {phase === "unavailable" && (
        <div className="notice notice-amber" role="alert">
          <AlertTriangle size={15} /> {error} No payment or posting action is permitted.
          <button className="secondary-button" type="button" onClick={() => void refreshSelector()}>
            Retry legal employers
          </button>
        </div>
      )}
      {phase === "ready" && (
        <label className="field" style={{ display: "grid", maxWidth: 380, marginTop: 12 }}>
          <span>Legal employer (required)</span>
          <select aria-label="Government loan legal employer" value={selectedId ?? ""}
            disabled={mutationBusy}
            onChange={(event) => {
              const id = Number(event.target.value);
              setSelectedId(Number.isSafeInteger(id) && id > 0 &&
                options.some((item) => item.id === id) ? id : null);
            }}>
            {options.length > 1 && <option value="">Select legal employer…</option>}
            {options.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
          </select>
        </label>
      )}
      {phase === "ready" && selectedId === null &&
        <div className="notice notice-amber" role="status">
          Select a legal employer before opening government loan remittances.
        </div>}
      {phase === "ready" && selectedId !== null &&
        <GovernmentLoanRemittancePanelContent key={props.organizationId + ":" + selectedId}
          {...props} legalEntityId={selectedId} onMutationBusy={setMutationBusy} />}
    </div>
  );
}

function GovernmentLoanRemittancePanelContent({
  organizationId,
  legalEntityId,
  setNotice,
  onMutationBusy,
}: PanelProps & { legalEntityId: number; onMutationBusy: (busy: boolean) => void }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [month, setMonth] = useState(previousMonth());
  const [busy, setBusy] = useState<string | null>(null);
  const [readPhase, setReadPhase] = useState<"loading" | "verified" | "unavailable">("loading");
  const [readError, setReadError] = useState("");
  const [paymentBatchId, setPaymentBatchId] = useState<number | null>(null);
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [agencyAcknowledgementReference, setAgencyAcknowledgementReference] = useState("");
  const [paymentVarianceNote, setPaymentVarianceNote] = useState("");
  const [postingMemberId, setPostingMemberId] = useState<number | null>(null);
  const [postingAmount, setPostingAmount] = useState("");
  const [postingReference, setPostingReference] = useState("");
  const [exceptionNote, setExceptionNote] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setReadPhase("loading");
    setReadError("");
    setBatches([]);
    setMembers([]);
    try {
      const verified = await readVerifiedGovernmentLoanRemittances(organizationId, legalEntityId, fetch, signal);
      if (signal?.aborted) return;
      setBatches(verified.batches);
      setMembers(verified.members);
      setReadPhase("verified");
      return verified;
    } catch (caught) {
      if (!signal?.aborted) {
        setBatches([]);
        setMembers([]);
        setReadPhase("unavailable");
        setReadError(caught instanceof Error ? caught.message : "Loan remittance evidence unavailable.");
      }
      throw caught;
    }
  }, [organizationId, legalEntityId]);

  useEffect(() => {
    const controller = new AbortController();
    // The request runs after effect setup, never in its synchronous phase.
    // Strict Mode cleanup can cancel this scheduled read before it starts.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void load(controller.signal).catch((error) => {
        if (controller.signal.aborted) return;
        setNotice(error instanceof Error ? error.message : "Could not load government loan remittances.");
      });
    });
    return () => controller.abort();
  }, [load, setNotice]);

  const monthBatches = useMemo(
    () => batches.filter((batch) => batch.applicableMonth === month),
    [batches, month],
  );

  async function mutate(action: string, payload: Record<string, unknown>, success: string) {
    if (readPhase !== "verified" || busy !== null) {
      setNotice("Loan remittance controls are unavailable until the employer evidence read is verified.");
      return false;
    }
    setBusy(action);
    onMutationBusy(true);
    let postAccepted = false;
    try {
      const response = await fetch("/api/compliance/government-loan-remittances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, legalEntityId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Government loan remittance action failed.");
      postAccepted = true;
      const refreshed = await load();
      if (!refreshed ||
          !confirmedGovernmentLoanMutation(action, body, refreshed, organizationId, legalEntityId)) {
        throw Error("Saved receipt does not match the refreshed authorized record.");
      }
      setNotice(success);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Government loan remittance action failed.";
      setNotice(postAccepted
        ? "This action may have been recorded; inspect the saved legal-employer batch or member posting before retrying. " + message
        : message);
      return false;
    } finally {
      setBusy(null);
      onMutationBusy(false);
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

  if (readPhase !== "verified") return (
    <article className="card" style={{ marginTop: 18 }} data-government-loan-remittance>
      <div className="notice notice-amber" role={readPhase === "unavailable" ? "alert" : "status"}>
        <AlertTriangle size={15} />
        <span>{readPhase === "loading" ? "Verifying government loan remittance evidence…" : "Government loan remittance controls unavailable. " + readError + " No payment or posting action is permitted."}</span>
        {readPhase === "unavailable" && <button type="button" className="secondary-button" onClick={() => void load().catch(() => undefined)}>Retry remittance evidence</button>}
      </div>
    </article>
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
        <button className="secondary-button" onClick={() => void load()} disabled={busy !== null}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
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
              disabled={busy !== null || monthBatches.some((batch) => batch.agency === agency)}
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

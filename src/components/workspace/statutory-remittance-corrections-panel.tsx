"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FilePenLine, RefreshCcw, XCircle } from "lucide-react";
import type { Notify } from "./types";
import { Spinner, Status, money } from "./ui";
import { parseRemittanceCorrectionsRead, type RemittanceCorrectionBatch as Batch, type RemittanceCorrectionMember as Member, type RemittanceCorrectionRequest as Correction, type RemittanceCorrectionPermissions as CorrectionPayload } from "@/lib/statutory-remittance-corrections-read";

function formatDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function summarize(snapshot: Record<string, unknown>) {
  const keys = [
    "amountPaid",
    "paymentReference",
    "agencyReceiptReference",
    "paymentChannel",
    "paymentVarianceNote",
    "paidAt",
    "postingReference",
    "postedAmount",
    "postedAt",
    "employeeNo",
    "employeeShare",
    "employerShare",
    "totalContribution",
    "batchExpectedTotal",
  ];
  return keys
    .filter((key) => snapshot[key] != null && String(snapshot[key]).trim() !== "")
    .map((key) => `${key}: ${String(snapshot[key])}`)
    .join(" · ");
}

type StatutoryRemittanceCorrectionsPanelProps = {
  organizationId: number;
  legalEntityId: number | null;
  viewerUserId: number | null;
  viewerRole: string | null;
  companyWide: boolean;
  notify: Notify;
};

type BatchPaymentDraft = {
  amountPaid: string;
  paymentReference: string;
  agencyReceiptReference: string;
  paymentChannel: string;
  paymentVarianceNote: string;
  paidAt: string;
};
type MemberPostingDraft = { postingReference: string; postedAmount: string; postedAt: string };

function paymentDefaults(batch: Batch | null): BatchPaymentDraft {
  return {
    amountPaid: batch?.amountPaid ?? "",
    paymentReference: batch?.paymentReference ?? "",
    agencyReceiptReference: batch?.agencyReceiptReference ?? "",
    paymentChannel: batch?.paymentChannel ?? "",
    paymentVarianceNote: batch?.paymentVarianceNote ?? "",
    paidAt: formatDateTimeLocal(batch?.paidAt),
  };
}
function postingDefaults(member: Member | null): MemberPostingDraft {
  return {
    postingReference: member?.postingReference ?? "",
    postedAmount: member?.postedAmount ?? member?.totalContribution ?? "",
    postedAt: formatDateTimeLocal(member?.postedAt),
  };
}

// Corrections, free-form evidence drafts and independent-approval decisions
// are employer-local. Changing A -> B -> A mounts a new empty state.
export function StatutoryRemittanceCorrectionsPanel(props: StatutoryRemittanceCorrectionsPanelProps) {
  return <StatutoryRemittanceCorrectionsPanelForOrganization key={JSON.stringify([props.organizationId, props.legalEntityId, props.viewerUserId, props.viewerRole, props.companyWide])} {...props} />;
}

function StatutoryRemittanceCorrectionsPanelForOrganization({
  organizationId,
  legalEntityId,
  viewerUserId,
  notify,
}: StatutoryRemittanceCorrectionsPanelProps) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [correctionData, setCorrectionData] = useState<CorrectionPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "error">("loading");
  const [readError, setReadError] = useState("");
  const readRevisionRef = useRef(0);

  const [targetType, setTargetType] = useState<"batch_payment" | "member_posting">("batch_payment");
  const [batchId, setBatchId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [reason, setReason] = useState("");
  // Draft edits are owned by an evidence record. Untouched fields derive from
  // the freshest authorized read, not from state copied by an effect.
  const [paymentEdit, setPaymentEdit] = useState<{ id: number; values: BatchPaymentDraft } | null>(null);
  const [postingEdit, setPostingEdit] = useState<{ id: number; values: MemberPostingDraft } | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<number, string>>({});

  const load = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    const revision = ++readRevisionRef.current;
    const isCurrent = () => !signal?.aborted && revision === readRevisionRef.current;
    // Remove old approval powers and amounts before attempting either scoped read.
    setReadState("loading");
    setBatches([]);
    setMembers([]);
    setCorrectionData(null);
    setReadError("");
    try {
      const query = "?organizationId=" + organizationId +
        (legalEntityId ? "&legalEntityId=" + legalEntityId : "");
      const [remittanceResponse, correctionResponse] = await Promise.all([
        fetch("/api/compliance/statutory-remittances" + query, { cache: "no-store", signal }),
        fetch("/api/compliance/statutory-remittance-corrections" + query, { cache: "no-store", signal }),
      ]);
      const [remittanceBody, correctionBody]: unknown[] = await Promise.all([
        remittanceResponse.json().catch(() => null),
        correctionResponse.json().catch(() => null),
      ]);
      if (!isCurrent()) return false;
      if (!remittanceResponse.ok || !correctionResponse.ok) {
        throw new Error("Authorized remittance corrections could not be loaded.");
      }
      const verified = parseRemittanceCorrectionsRead(remittanceBody, correctionBody, {
        organizationId, legalEntityId, viewerUserId,
      });
      if (!verified) throw new Error("Remittance corrections are incomplete or not scoped to the selected employer and viewer.");
      setBatches(verified.batches);
      setMembers(verified.members);
      setCorrectionData(verified.correctionData);
      setReadError("");
      setReadState("ready");
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      // A failed or partial read must never impersonate "no pending approvals".
      setBatches([]);
      setMembers([]);
      setCorrectionData(null);
      const message = error instanceof Error ? error.message : "Could not load remittance corrections.";
      setReadError(message);
      setReadState("error");
      notify(message, "err");
      return false;
    }
  }, [organizationId, legalEntityId, viewerUserId, notify]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => {
      controller.abort();
      readRevisionRef.current += 1;
    };
  }, [load]);

  const refresh = () => {
    setReadState("loading");
    void load();
  };

  const recordedBatches = useMemo(
    () => batches.filter((batch) => batch.status !== "open" && batch.amountPaid != null && batch.paidAt),
    [batches],
  );
  const confirmedMembers = useMemo(
    () => members.filter((member) => member.postingStatus === "confirmed" && member.postedAmount != null && member.postedAt),
    [members],
  );
  const selectedBatch = batches.find((batch) => batch.id === Number(batchId)) ?? null;
  const selectedMember = members.find((member) => member.id === Number(memberId)) ?? null;

  // When selection is empty, neither an undefined ID nor an old draft may
  // authorize a payment/posting value (undefined === undefined is true).
  const paymentForm = paymentEdit && selectedBatch && paymentEdit.id === selectedBatch.id
    ? paymentEdit.values : paymentDefaults(selectedBatch);
  const postingForm = postingEdit && selectedMember && postingEdit.id === selectedMember.id
    ? postingEdit.values : postingDefaults(selectedMember);
  const editPayment = (key: keyof BatchPaymentDraft, value: string) => {
    if (!selectedBatch) return;
    setPaymentEdit({ id: selectedBatch.id, values: { ...paymentForm, [key]: value } });
  };
  const editPosting = (key: keyof MemberPostingDraft, value: string) => {
    if (!selectedMember) return;
    setPostingEdit({ id: selectedMember.id, values: { ...postingForm, [key]: value } });
  };

  async function mutate(action: string, payload: Record<string, unknown>, success: string) {
    setBusy(action);
    try {
      const response = await fetch("/api/compliance/statutory-remittance-corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Remittance correction action failed.");
      const verified = await load();
      window.dispatchEvent(new Event("statutory-remittance-changed"));
      notify(verified ? success : "The correction request may have succeeded, but the current employer evidence could not be verified. Refresh before retrying.", verified ? "ok" : "err");
      return verified;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Remittance correction action failed.", "err");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function requestCorrection() {
    if (!correctionData?.canRequest
      || (targetType === "batch_payment"
        ? !selectedBatch || !recordedBatches.some((item) => item.id === selectedBatch.id)
        : !selectedMember || !confirmedMembers.some((item) => item.id === selectedMember.id))) {
      notify("Select an authorized, recorded remittance item before requesting a correction.", "err");
      return;
    }
    if (reason.trim().length < 8) {
      notify("Explain why this evidence needs correction.", "err");
      return;
    }

    const ok = targetType === "batch_payment"
      ? await mutate("request_payment_correction", {
          batchId: Number(batchId),
          amountPaid: Number(paymentForm.amountPaid),
          paymentReference: paymentForm.paymentReference,
          agencyReceiptReference: paymentForm.agencyReceiptReference,
          paymentChannel: paymentForm.paymentChannel,
          paymentVarianceNote: paymentForm.paymentVarianceNote,
          paidAt: paymentForm.paidAt ? new Date(paymentForm.paidAt).toISOString() : "",
          reason,
        }, "Payment evidence correction sent for independent approval.")
      : await mutate("request_posting_correction", {
          memberId: Number(memberId),
          postingReference: postingForm.postingReference,
          postedAmount: Number(postingForm.postedAmount),
          postedAt: postingForm.postedAt ? new Date(postingForm.postedAt).toISOString() : "",
          reason,
        }, "Employee posting correction sent for independent approval.");

    if (ok) {
      setReason("");
      setBatchId("");
      setMemberId("");
      setPaymentEdit(null);
      setPostingEdit(null);
    }
  }

  async function decide(correction: Correction, action: "approve" | "reject") {
    await mutate(action, {
      correctionId: correction.id,
      decisionNote: decisionNotes[correction.id] ?? "",
    }, action === "approve"
      ? "Correction approved and applied with audit evidence."
      : "Correction rejected; original evidence remains unchanged.");
  }

  const pending = (correctionData?.corrections ?? []).filter((item) => item.status === "pending");
  const history = (correctionData?.corrections ?? []).filter((item) => item.status !== "pending").slice(-10).reverse();

  if (readState !== "ready") {
    return (
      <article className="card" style={{ marginBottom: 16 }} data-remittance-corrections>
        <div className="card-header">
          <div>
            <div className="card-kicker">AUDITED EVIDENCE CORRECTIONS</div>
            <h2>{readState === "loading" ? "Loading remittance evidence…" : "Remittance corrections unavailable"}</h2>
            <p role={readState === "error" ? "alert" : "status"}>
              {readState === "error"
                ? readError + " No correction requests or approvals are shown without authorized evidence."
                : "Fetching the current employer's recorded payments, agency postings, and approval permissions."}
            </p>
          </div>
          {readState === "error" && (
            <button className="secondary-button" disabled={busy !== null} onClick={refresh}>
              <RefreshCcw size={14} /> Retry
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className="card" style={{ marginBottom: 16 }} data-remittance-corrections>
      <div className="card-header">
        <div>
          <div className="card-kicker">AUDITED EVIDENCE CORRECTIONS</div>
          <h2>Correct immutable remittance evidence without rewriting history.</h2>
          <p>
            A payroll operator proposes the correction. A different Owner, Admin, or Checker must approve it before the recorded evidence changes.
          </p>
        </div>
        <button className="secondary-button" onClick={refresh} disabled={busy !== null}>
          <RefreshCcw size={14} /> Refresh
        </button>
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
        {correctionData?.canRequest && (
          <section className="leave-request" style={{ display: "grid", gap: 10 }}>
            <div className="card-kicker">Request correction</div>
            <div className="setting-form">
              <label>
                Evidence type
                <select value={targetType} onChange={(event) => {
                  setTargetType(event.target.value as "batch_payment" | "member_posting");
                  setBatchId("");
                  setMemberId("");
                }}>
                  <option value="batch_payment">Employer payment evidence</option>
                  <option value="member_posting">Employee agency posting</option>
                </select>
              </label>

              {targetType === "batch_payment" ? (
                <>
                  <label>
                    Remittance batch
                    <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
                      <option value="">Select batch</option>
                      {recordedBatches.map((batch) => (
                        <option key={batch.id} value={batch.id}>
                          {batch.agency} · {batch.applicableMonth} · {money(batch.expectedTotal)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>Amount paid<input type="number" min="0" step="0.01" value={paymentForm.amountPaid} onChange={(event) => editPayment("amountPaid", event.target.value)} /></label>
                  <label>Payment reference<input value={paymentForm.paymentReference} onChange={(event) => editPayment("paymentReference", event.target.value)} /></label>
                  <label>Agency receipt<input value={paymentForm.agencyReceiptReference} onChange={(event) => editPayment("agencyReceiptReference", event.target.value)} /></label>
                  <label>Payment channel<input value={paymentForm.paymentChannel} onChange={(event) => editPayment("paymentChannel", event.target.value)} /></label>
                  <label>Penalty / variance note<input value={paymentForm.paymentVarianceNote} onChange={(event) => editPayment("paymentVarianceNote", event.target.value)} /></label>
                  <label>Paid at<input type="datetime-local" value={paymentForm.paidAt} onChange={(event) => editPayment("paidAt", event.target.value)} /></label>
                </>
              ) : (
                <>
                  <label>
                    Confirmed employee posting
                    <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
                      <option value="">Select employee posting</option>
                      {confirmedMembers.map((member) => {
                        const batch = batches.find((item) => item.id === member.batchId);
                        return (
                          <option key={member.id} value={member.id}>
                            {member.employeeNo} · {batch?.agency ?? "Agency"} {batch?.applicableMonth ?? ""} · {money(member.totalContribution)}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>Posted amount<input type="number" min="0" step="0.01" value={postingForm.postedAmount} onChange={(event) => editPosting("postedAmount", event.target.value)} /></label>
                  <label>Posting reference<input value={postingForm.postingReference} onChange={(event) => editPosting("postingReference", event.target.value)} /></label>
                  <label>Posted at<input type="datetime-local" value={postingForm.postedAt} onChange={(event) => editPosting("postedAt", event.target.value)} /></label>
                </>
              )}
              <label>
                Correction reason
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the evidence error and source of the corrected value" />
              </label>
            </div>
            <div className="run-actions">
              <button
                className="primary-button brand"
                disabled={
                  busy !== null
                  || reason.trim().length < 8
                  || (targetType === "batch_payment" ? !selectedBatch : !selectedMember)
                }
                onClick={() => void requestCorrection()}
              >
                {busy?.startsWith("request_") ? <Spinner label="Submitting" /> : <FilePenLine size={14} />}
                Request correction
              </button>
            </div>
          </section>
        )}

        <section>
          <div className="card-kicker" style={{ marginBottom: 8 }}>Pending independent approval</div>
          {pending.length === 0 ? (
            <div className="notice" style={{ margin: 0 }}>
              <CheckCircle2 size={15} />
              <span>No remittance evidence corrections are waiting for approval.</span>
            </div>
          ) : (
            <div className="data-table-wrap slim-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Target</th><th>Requested by</th><th>Reason</th><th>Before / proposed</th><th>Decision</th></tr>
                </thead>
                <tbody>
                  {pending.map((correction) => {
                    const isOwn = correction.requestedByUserId === correctionData?.currentUserId;
                    const canDecide = correctionData?.canApprove && !isOwn;
                    return (
                      <tr key={correction.id}>
                        <td>
                          <Status value={
                            correction.targetType === "batch_payment"
                              ? "Payment"
                              : correction.targetType === "member_addition"
                                ? "Missing member"
                                : "Posting"
                          } />
                          <div className="id">#{correction.id}</div>
                        </td>
                        <td>{correction.requestedByName}</td>
                        <td>{correction.reason}</td>
                        <td>
                          <small style={{ display: "block", color: "var(--muted)" }}>Before: {summarize(correction.originalSnapshot)}</small>
                          <small style={{ display: "block", marginTop: 4 }}>Proposed: {summarize(correction.proposedSnapshot)}</small>
                        </td>
                        <td>
                          {canDecide ? (
                            <div style={{ display: "grid", gap: 6 }}>
                              <input
                                value={decisionNotes[correction.id] ?? ""}
                                onChange={(event) => setDecisionNotes((current) => ({
                                  ...current,
                                  [correction.id]: event.target.value,
                                }))}
                                placeholder="Decision note (optional)"
                              />
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <button className="secondary-button" disabled={busy !== null} onClick={() => void decide(correction, "approve")}>
                                  <CheckCircle2 size={14} /> Approve
                                </button>
                                <button className="secondary-button" disabled={busy !== null} onClick={() => void decide(correction, "reject")}>
                                  <XCircle size={14} /> Reject
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="id">{isOwn ? "Needs another approver" : "Approver role required"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {history.length > 0 && (
          <section>
            <div className="card-kicker" style={{ marginBottom: 8 }}>Correction history</div>
            <div className="policy-lines">
              {history.map((correction) => (
                <span key={correction.id}>
                  <b>#{correction.id} · {
                    correction.targetType === "batch_payment"
                      ? "Payment evidence"
                      : correction.targetType === "member_addition"
                        ? "Missing remittance member"
                        : "Employee posting"
                  } · {correction.status}</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>
                    Requested by {correction.requestedByName}{correction.decidedByName ? ` · decided by ${correction.decidedByName}` : ""}
                    {correction.decisionNote ? ` · ${correction.decisionNote}` : ""}
                  </small>
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </article>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FilePenLine, RefreshCcw, XCircle } from "lucide-react";
import type { Notify } from "./types";
import { Spinner, Status, money } from "./ui";

type Batch = {
  id: number;
  agency: string;
  applicableMonth: string;
  status: string;
  expectedTotal: string;
  amountPaid: string | null;
  paymentReference: string | null;
  agencyReceiptReference: string | null;
  paymentChannel: string | null;
  paymentVarianceNote: string | null;
  paidAt: string | null;
};

type Member = {
  id: number;
  batchId: number;
  employeeNo: string;
  totalContribution: string;
  postingStatus: string;
  postingReference: string | null;
  postedAmount: string | null;
  postedAt: string | null;
};

type Correction = {
  id: number;
  targetType: "batch_payment" | "member_posting" | "member_addition";
  batchId: number;
  memberId: number | null;
  originalSnapshot: Record<string, unknown>;
  proposedSnapshot: Record<string, unknown>;
  reason: string;
  status: string;
  requestedByUserId: number | null;
  requestedByName: string;
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
};

type CorrectionPayload = {
  corrections: Correction[];
  canRequest: boolean;
  canApprove: boolean;
  currentUserId: number;
};

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

export function StatutoryRemittanceCorrectionsPanel({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [correctionData, setCorrectionData] = useState<CorrectionPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [targetType, setTargetType] = useState<"batch_payment" | "member_posting">("batch_payment");
  const [batchId, setBatchId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [reason, setReason] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [agencyReceiptReference, setAgencyReceiptReference] = useState("");
  const [paymentChannel, setPaymentChannel] = useState("");
  const [paymentVarianceNote, setPaymentVarianceNote] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [postingReference, setPostingReference] = useState("");
  const [postedAmount, setPostedAmount] = useState("");
  const [postedAt, setPostedAt] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const [remittanceResponse, correctionResponse] = await Promise.all([
      fetch(`/api/compliance/statutory-remittances?organizationId=${organizationId}`, { cache: "no-store" }),
      fetch(`/api/compliance/statutory-remittance-corrections?organizationId=${organizationId}`, { cache: "no-store" }),
    ]);
    const [remittanceBody, correctionBody] = await Promise.all([
      remittanceResponse.json().catch(() => ({})),
      correctionResponse.json().catch(() => ({})),
    ]);
    if (!remittanceResponse.ok) {
      throw new Error(remittanceBody.error ?? "Could not load remittance evidence.");
    }
    if (!correctionResponse.ok) {
      throw new Error(correctionBody.error ?? "Could not load remittance corrections.");
    }
    setBatches(Array.isArray(remittanceBody.batches) ? remittanceBody.batches : []);
    setMembers(Array.isArray(remittanceBody.members) ? remittanceBody.members : []);
    setCorrectionData(correctionBody as CorrectionPayload);
  }, [organizationId]);

  useEffect(() => {
    void load().catch((error) => notify(
      error instanceof Error ? error.message : "Could not load remittance corrections.",
      "err",
    ));
  }, [load, notify]);

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

  useEffect(() => {
    if (!selectedBatch || targetType !== "batch_payment") return;
    setAmountPaid(selectedBatch.amountPaid ?? "");
    setPaymentReference(selectedBatch.paymentReference ?? "");
    setAgencyReceiptReference(selectedBatch.agencyReceiptReference ?? "");
    setPaymentChannel(selectedBatch.paymentChannel ?? "");
    setPaymentVarianceNote(selectedBatch.paymentVarianceNote ?? "");
    setPaidAt(formatDateTimeLocal(selectedBatch.paidAt));
  }, [selectedBatch, targetType]);

  useEffect(() => {
    if (!selectedMember || targetType !== "member_posting") return;
    setPostingReference(selectedMember.postingReference ?? "");
    setPostedAmount(selectedMember.postedAmount ?? selectedMember.totalContribution);
    setPostedAt(formatDateTimeLocal(selectedMember.postedAt));
  }, [selectedMember, targetType]);

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
      notify(success, "ok");
      await load();
      window.dispatchEvent(new Event("statutory-remittance-changed"));
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Remittance correction action failed.", "err");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function requestCorrection() {
    if (reason.trim().length < 8) {
      notify("Explain why this evidence needs correction.", "err");
      return;
    }

    const ok = targetType === "batch_payment"
      ? await mutate("request_payment_correction", {
          batchId: Number(batchId),
          amountPaid: Number(amountPaid),
          paymentReference,
          agencyReceiptReference,
          paymentChannel,
          paymentVarianceNote,
          paidAt: paidAt ? new Date(paidAt).toISOString() : "",
          reason,
        }, "Payment evidence correction sent for independent approval.")
      : await mutate("request_posting_correction", {
          memberId: Number(memberId),
          postingReference,
          postedAmount: Number(postedAmount),
          postedAt: postedAt ? new Date(postedAt).toISOString() : "",
          reason,
        }, "Employee posting correction sent for independent approval.");

    if (ok) setReason("");
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
        <button className="secondary-button" onClick={() => void load()} disabled={busy !== null}>
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
                  <label>Amount paid<input type="number" min="0" step="0.01" value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} /></label>
                  <label>Payment reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label>
                  <label>Agency receipt<input value={agencyReceiptReference} onChange={(event) => setAgencyReceiptReference(event.target.value)} /></label>
                  <label>Payment channel<input value={paymentChannel} onChange={(event) => setPaymentChannel(event.target.value)} /></label>
                  <label>Penalty / variance note<input value={paymentVarianceNote} onChange={(event) => setPaymentVarianceNote(event.target.value)} /></label>
                  <label>Paid at<input type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label>
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
                  <label>Posted amount<input type="number" min="0" step="0.01" value={postedAmount} onChange={(event) => setPostedAmount(event.target.value)} /></label>
                  <label>Posting reference<input value={postingReference} onChange={(event) => setPostingReference(event.target.value)} /></label>
                  <label>Posted at<input type="datetime-local" value={postedAt} onChange={(event) => setPostedAt(event.target.value)} /></label>
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
                  || (targetType === "batch_payment" ? !batchId : !memberId)
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Landmark, RefreshCw, ShieldCheck } from "lucide-react";
import type { Notify } from "./types";
import { Spinner, Status, money } from "./ui";
import { StatutoryPostingImport } from "./statutory-posting-import";
import { StatutoryPaymentProof } from "./statutory-payment-proof";

type Agency = "SSS" | "PhilHealth" | "Pag-IBIG";
type Batch = {
  id: number;
  agency: Agency;
  applicableMonth: string;
  dueDate: string;
  status: string;
  displayStatus: string;
  employeeCount: number;
  expectedEmployeeShare: string;
  expectedEmployerShare: string;
  expectedTotal: string;
  amountPaid: string | null;
  paymentReference: string | null;
  agencyReceiptReference: string | null;
  paidAt: string | null;
  pendingPostingCount: number;
  exceptionCount: number;
  filingCheck?: {
    status: "matched" | "mismatch" | "unverified";
    filingRecordId: number | null;
    filingEmployeeCount: number | null;
    remittanceEmployeeCount: number;
    filingTotal: number | null;
    remittanceTotal: number;
    employeeCountDifference: number | null;
    totalDifference: number | null;
  };
};
type CoverageGap = { applicableMonth: string; agency: Agency };

type Member = {
  id: number;
  batchId: number;
  employeeId: number;
  employeeNo: string;
  employeeShare: string;
  employerShare: string;
  totalContribution: string;
  postingStatus: string;
  postingReference: string | null;
  postedAmount: string | null;
  postingEvidenceArtifactId: number | null;
  postingEvidenceSource: string | null;
  postingEvidenceHashSha256: string | null;
  postingEvidenceFileName: string | null;
  postingEvidenceByteSize: number | null;
  exceptionNote: string | null;
};

export function StatutoryRemittancePanel({
  organizationId,
  legalEntityId,
  defaultMonth,
  notify,
}: {
  organizationId: number;
  legalEntityId?: number | null;
  defaultMonth: string;
  notify: Notify;
}) {
  const [month, setMonth] = useState(defaultMonth);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [coverageGaps, setCoverageGaps] = useState<CoverageGap[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [paymentBatchId, setPaymentBatchId] = useState<number | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [agencyReceiptReference, setAgencyReceiptReference] = useState("");
  const [paymentChannel, setPaymentChannel] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentVarianceNote, setPaymentVarianceNote] = useState("");
  const [postingMemberId, setPostingMemberId] = useState<number | null>(null);
  const [postingReference, setPostingReference] = useState("");
  const [postingAmount, setPostingAmount] = useState("");
  const [exceptionNote, setExceptionNote] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/compliance/statutory-remittances?organizationId=${organizationId}${legalEntityId ? `&legalEntityId=${legalEntityId}` : ""}`,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load statutory remittances.");
    setBatches(Array.isArray(body.batches) ? body.batches : []);
    setMembers(Array.isArray(body.members) ? body.members : []);
    setCoverageGaps(Array.isArray(body.coverageGaps) ? body.coverageGaps : []);
  }, [legalEntityId, organizationId]);

  useEffect(() => {
    void load().catch((error) => notify(
      error instanceof Error ? error.message : "Could not load statutory remittances.",
      "err",
    ));
  }, [load, notify]);

  const monthBatches = useMemo(
    () => batches.filter((batch) => batch.applicableMonth === month),
    [batches, month],
  );

  async function mutate(action: string, payload: Record<string, unknown>, success: string) {
    setBusy(action);
    try {
      const response = await fetch("/api/compliance/statutory-remittances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, legalEntityId: legalEntityId ?? undefined, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Statutory remittance action failed.");
      notify(success, "ok");
      await load();
      window.dispatchEvent(new Event("statutory-remittance-changed"));
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Statutory remittance action failed.", "err");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createBatch(agency: Agency) {
    await mutate("create_batch", { agency, applicableMonth: month }, `${agency} remittance liability snapshotted from released payroll.`);
  }

  async function recordPayment(batch: Batch) {
    const ok = await mutate("record_payment", {
      batchId: batch.id,
      amountPaid: Number(amountPaid || batch.expectedTotal),
      paymentReference,
      agencyReceiptReference,
      paymentChannel,
      paymentVarianceNote,
    }, `${batch.agency} payment recorded. Employee posting reconciliation is still required.`);
    if (ok) {
      setPaymentBatchId(null);
      setPaymentReference("");
      setAgencyReceiptReference("");
      setPaymentChannel("");
      setAmountPaid("");
      setPaymentVarianceNote("");
    }
  }

  async function confirmPosting(member: Member) {
    const ok = await mutate("confirm_member_posting", {
      memberId: member.id,
      postingReference,
      postedAmount: Number(postingAmount),
    }, `${member.employeeNo} posting confirmed against agency evidence.`);
    if (ok) {
      setPostingMemberId(null);
      setPostingReference("");
      setPostingAmount("");
    }
  }

  async function markException(member: Member) {
    const ok = await mutate("mark_member_exception", {
      memberId: member.id,
      exceptionNote,
    }, `${member.employeeNo} marked as a posting exception.`);
    if (ok) {
      setPostingMemberId(null);
      setPostingAmount("");
      setPostingReference("");
      setExceptionNote("");
    }
  }

  return (
    <article className="card" style={{ marginBottom: 16 }} data-statutory-remittance>
      <div className="card-header">
        <div>
          <div className="card-kicker">STATUTORY REMITTANCE CONTROL</div>
          <h2>Deducted does not mean remitted.</h2>
          <p>
            Reconcile SSS, PhilHealth and Pag-IBIG from released payroll to payment evidence, then confirm each employee&apos;s agency posting.
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
            A filing acceptance is not treated as proof of payment or employee posting. A batch is only <strong>reconciled</strong> when payment matches the payroll liability and every employee is confirmed.
          </span>
        </div>

        <div className="notice" style={{ margin: 0 }}>
          <ShieldCheck size={15} />
          <span>
            Before a remittance batch opens, PayrollPH independently recomputes the month&apos;s mandatory SSS, PhilHealth and Pag-IBIG employee/employer shares. Any material variance blocks the batch until payroll is corrected.
          </span>
        </div>

        {coverageGaps.length > 0 && (
          <div className="notice notice-red" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span>
              <strong>{coverageGaps.length} missing remittance control{coverageGaps.length === 1 ? "" : "s"}.</strong>{" "}
              {coverageGaps.slice(0, 6).map((gap) => `${gap.agency} ${gap.applicableMonth}`).join(" · ")}
              {coverageGaps.length > 6 ? " · …" : ""}
            </span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label className="field" style={{ minWidth: 180 }}>
            <span>Applicable month</span>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          {(["SSS", "PhilHealth", "Pag-IBIG"] as Agency[]).map((agency) => (
            <button
              key={agency}
              className="secondary-button"
              disabled={busy !== null || monthBatches.some((batch) => batch.agency === agency)}
              onClick={() => void createBatch(agency)}
            >
              {busy === "create_batch" ? <Spinner label="Saving" /> : <Landmark size={14} />}
              {monthBatches.some((batch) => batch.agency === agency) ? `${agency} created` : `Open ${agency}`}
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
                  <strong>{batch.agency} · {batch.applicableMonth}</strong>
                  <p style={{ margin: "3px 0 0" }}>
                    Due {batch.dueDate} · {batch.employeeCount} employees · expected {money(batch.expectedTotal)}
                  </p>
                </div>
                <Status value={batch.displayStatus} />
              </div>

              <div className="run-stats" style={{ margin: 0 }}>
                <div><span>Employee deductions</span><strong>{money(batch.expectedEmployeeShare)}</strong></div>
                <div><span>Employer share</span><strong>{money(batch.expectedEmployerShare)}</strong></div>
                <div><span>Posting left</span><strong>{batch.pendingPostingCount}</strong><small>{batch.exceptionCount ? `${batch.exceptionCount} exception(s)` : "employee records"}</small></div>
              </div>

              {batch.filingCheck?.status === "matched" && (
                <div className="notice notice-green" style={{ margin: 0 }}>
                  <CheckCircle2 size={15} />
                  <span>
                    <strong>Accepted filing matches this remittance snapshot.</strong>{" "}
                    {batch.filingCheck.filingEmployeeCount} employees · {money(batch.filingCheck.filingTotal ?? 0)} total contribution.
                  </span>
                </div>
              )}
              {batch.filingCheck?.status === "mismatch" && (
                <div className="notice notice-red" style={{ margin: 0 }}>
                  <AlertTriangle size={15} />
                  <span>
                    <strong>Accepted filing does not match this remittance liability.</strong>{" "}
                    Filing: {batch.filingCheck.filingEmployeeCount} employees / {money(batch.filingCheck.filingTotal ?? 0)}.
                    Remittance: {batch.filingCheck.remittanceEmployeeCount} employees / {money(batch.filingCheck.remittanceTotal)}.
                  </span>
                </div>
              )}
              {batch.filingCheck?.status === "unverified" && (
                <div className="notice notice-blue" style={{ margin: 0 }}>
                  <ShieldCheck size={15} />
                  <span>
                    No accepted current-version file upload is available to cross-check this remittance total yet. Manual-entry filing evidence does not prove the generated file totals matched.
                  </span>
                </div>
              )}

              <StatutoryPaymentProof
                organizationId={organizationId}
                batchId={batch.id}
                batchStatus={batch.status}
                notify={notify}
              />

              {batch.status === "open" && (
                <>
                  <button className="primary-button brand" onClick={() => setPaymentBatchId(paymentOpen ? null : batch.id)}>
                    <ShieldCheck size={14} /> Record payment evidence
                  </button>
                  {paymentOpen && (
                    <div className="setting-form">
                      <label>Amount paid<input type="number" min={batch.expectedTotal} step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder={batch.expectedTotal} /></label>
                      <label>Payment reference<input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="PRN / SPA / OPIN / bank reference" /></label>
                      <label>Agency receipt / acknowledgement<input value={agencyReceiptReference} onChange={(e) => setAgencyReceiptReference(e.target.value)} placeholder="Official agency receipt reference" /></label>
                      <label>Payment channel<input value={paymentChannel} onChange={(e) => setPaymentChannel(e.target.value)} placeholder="My.SSS / EPRS / Virtual Pag-IBIG" /></label>
                      <label>Penalty / variance note<input value={paymentVarianceNote} onChange={(e) => setPaymentVarianceNote(e.target.value)} placeholder="Required only if payment exceeds contribution liability" /></label>
                      <div style={{ alignSelf: "end" }}>
                        <button className="primary-button brand" disabled={busy !== null} onClick={() => void recordPayment(batch)}>
                          Record payment
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {batch.status !== "open" && batch.status !== "reconciled" && (
                <StatutoryPostingImport
                  organizationId={organizationId}
                  batchId={batch.id}
                  agency={batch.agency}
                  applicableMonth={batch.applicableMonth}
                  notify={notify}
                  onImported={load}
                />
              )}

              {batch.status !== "open" && rows.length > 0 && (
                <div className="data-table-wrap slim-scroll">
                  <table className="data-table">
                    <thead><tr><th>Employee</th><th>Deducted</th><th>Employer</th><th>Total</th><th>Agency posting</th></tr></thead>
                    <tbody>
                      {rows.map((member) => (
                        <tr key={member.id}>
                          <td><strong>{member.employeeNo}</strong></td>
                          <td className="num">{money(member.employeeShare)}</td>
                          <td className="num">{money(member.employerShare)}</td>
                          <td className="num">{money(member.totalContribution)}</td>
                          <td>
                            {member.postingStatus === "confirmed" ? (
                              <div>
                                <span className="green-number"><CheckCircle2 size={13} /> Confirmed</span>
                                <div className="id">Posted {money(member.postedAmount ?? member.totalContribution)}</div>
                                {member.postingEvidenceSource && (
                                  <div className="id">
                                    {member.postingEvidenceSource}
                                    {member.postingEvidenceHashSha256
                                      ? ` · ${member.postingEvidenceHashSha256.slice(0, 12)}…`
                                      : ""}
                                  </div>
                                )}
                                {member.postingEvidenceArtifactId && member.postingEvidenceSource === "Imported agency evidence" && (
                                  <a
                                    className="secondary-button"
                                    style={{ marginTop: 6, display: "inline-flex" }}
                                    href={`/api/compliance/statutory-remittances/posting-evidence/${member.postingEvidenceArtifactId}`}
                                  >
                                    Download source evidence
                                  </a>
                                )}
                              </div>
                            ) : postingMemberId === member.id ? (
                              <div style={{ display: "grid", gap: 6 }}>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={postingAmount}
                                  onChange={(e) => setPostingAmount(e.target.value)}
                                  placeholder={member.totalContribution}
                                />
                                <input value={postingReference} onChange={(e) => setPostingReference(e.target.value)} placeholder="Agency member posting reference" />
                                <input value={exceptionNote} onChange={(e) => setExceptionNote(e.target.value)} placeholder="Or explain missing / incorrect posting" />
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <button className="secondary-button" disabled={!postingReference.trim() || !postingAmount || busy !== null} onClick={() => void confirmPosting(member)}>Confirm posted</button>
                                  <button className="secondary-button" disabled={!exceptionNote.trim() || busy !== null} onClick={() => void markException(member)}>Flag exception</button>
                                </div>
                              </div>
                            ) : member.postingStatus === "exception" ? (
                              <div style={{ display: "grid", gap: 6 }}>
                                <Status value="Exception" />
                                <div className="id">{member.exceptionNote}</div>
                                <button className="secondary-button" onClick={() => {
                                  setPostingMemberId(member.id);
                                  setPostingAmount(member.totalContribution);
                                  setPostingReference("");
                                  setExceptionNote(member.exceptionNote ?? "");
                                }}>Resolve exception</button>
                              </div>
                            ) : (
                              <button className="secondary-button" onClick={() => {
                                setPostingMemberId(member.id);
                                setPostingAmount(member.totalContribution);
                                setPostingReference("");
                                setExceptionNote("");
                              }}>Reconcile employee</button>
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

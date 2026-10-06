"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileCheck2, Paperclip, RefreshCw, ShieldCheck } from "lucide-react";

type EvidencePacket = {
  packetVersion: string;
  generatedAt: string;
  employee: {
    id: number;
    employeeNo: string;
    firstName: string;
    lastName: string;
    title: string;
    employmentType: string;
    status: string;
  };
  decision: {
    id: number;
    decisionKind: string;
    effectiveDate: string;
    status: string;
    reason: string;
    requestedBy: string;
    approvedBy: string | null;
    approvedAt: string | null;
    evidenceSnapshotSha256: string | null;
    evidenceSealedAt: string | null;
  };
  reviewEvidence: {
    notes: Array<{
      id: number;
      noteKind: string;
      content: string;
      createdByName: string;
      createdAt: string;
    }>;
    attachments: Array<{
      id: number;
      documentId: number;
      evidenceKind: string;
      label: string;
      fileName: string;
      mimeType: string;
      byteSize: number;
      sha256: string;
      scannedClean: boolean;
      attachedByName: string;
      attachedAt: string;
    }>;
    managerAttestations?: Array<{
      id: number;
      managerEmployeeId: number;
      managerUserId: number | null;
      managerName: string;
      recommendation: "support" | "do_not_support" | "needs_more_review";
      statement: string;
      workerPositionAssignmentId: number;
      workerPositionId: number;
      reportingLineSnapshot: Record<string, unknown>;
      createdAt: string;
    }>;
  };
  integrity: {
    sealed: boolean;
    sealedAt: string | null;
    sealedSha256: string | null;
    currentSha256: string;
    status: "verified" | "mismatch" | "unsealed";
  };
  timeline: Array<{
    id: number;
    eventType: string;
    actorName: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
};

type EvidenceResponse = {
  packet: EvidencePacket;
  canContribute: boolean;
  managerReviewOnly: boolean;
  uploadLimits: {
    maxBytes: number;
    accepted: string[];
  };
};

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactHash(value: string | null) {
  if (!value) return "—";
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export function HcmEmploymentDecisionEvidence({
  organizationId,
  decisionId,
  compact = false,
  onChanged,
}: {
  organizationId: number;
  decisionId: number;
  compact?: boolean;
  onChanged?: () => Promise<unknown> | unknown;
}) {
  const [payload, setPayload] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteKind, setNoteKind] = useState("hr_review");
  const [note, setNote] = useState("");
  const [managerRecommendation, setManagerRecommendation] = useState("support");
  const [managerStatement, setManagerStatement] = useState("");
  const [evidenceKind, setEvidenceKind] = useState("probation_evaluation");
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(
        `/api/hcm/employment-term-decisions/${decisionId}/evidence?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load the decision evidence packet.");
      setPayload(data as EvidenceResponse);
      if (!(data as EvidenceResponse).managerReviewOnly) setNoteKind("hr_review");
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load the decision evidence packet.");
    }
  }, [decisionId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const packet = payload?.packet ?? null;
  const notes = packet?.reviewEvidence.notes ?? [];
  const attachments = packet?.reviewEvidence.attachments ?? [];
  const managerAttestations = packet?.reviewEvidence.managerAttestations ?? [];
  const timeline = packet?.timeline ?? [];

  const accepted = useMemo(() => payload?.uploadLimits.accepted.join(",") ?? "application/pdf,image/png,image/jpeg", [payload]);

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/hcm/employment-term-decisions/${decisionId}/evidence`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            noteKind,
            note,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not add review evidence.");
      setNote("");
      await load();
      await onChanged?.();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not add review evidence.");
    } finally {
      setBusy(false);
    }
  }

  async function submitManagerAttestation(event: React.FormEvent) {
    event.preventDefault();
    if (managerStatement.trim().length < 20) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/hcm/employment-term-decisions/${decisionId}/manager-attestation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            recommendation: managerRecommendation,
            statement: managerStatement,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not submit manager attestation.");
      setManagerStatement("");
      await load();
      await onChanged?.();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not submit manager attestation.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !label.trim()) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("organizationId", String(organizationId));
      form.set("evidenceKind", evidenceKind);
      form.set("label", label);
      form.set("file", file);
      const response = await fetch(
        `/api/hcm/employment-term-decisions/${decisionId}/evidence`,
        { method: "POST", body: form },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not upload decision evidence.");
      setLabel("");
      setFile(null);
      await load();
      await onChanged?.();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not upload decision evidence.");
    } finally {
      setBusy(false);
    }
  }

  if (!payload && !error) return <div className="empty-state">Loading decision evidence…</div>;

  return (
    <section className="card" style={{ margin: compact ? "10px 0 0" : "12px 0 0", boxShadow: "none" }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">DECISION EVIDENCE PACKET</div>
          <h2 style={{ fontSize: 14 }}>
            {packet ? `Decision #${packet.decision.id} · ${readable(packet.decision.decisionKind)}` : "Employment decision evidence"}
          </h2>
          <p>
            Review notes, manager attestations, and supporting files are append-only while approval is pending. Approval seals the exact review evidence with SHA-256.
          </p>
        </div>
        <div className="run-actions">
          {packet && (
            <a
              className="secondary-button"
              href={`/api/hcm/employment-term-decisions/${decisionId}/evidence?organizationId=${organizationId}&download=1`}
            >
              <Download size={13} /> Download packet
            </a>
          )}
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="notice notice-amber" style={{ marginBottom: 12 }}><AlertTriangle size={15} /><span>{error}</span></div>}

      {packet && (
        <>
          <div className={
            packet.integrity.status === "verified"
              ? "notice notice-green"
              : packet.integrity.status === "mismatch"
                ? "notice notice-amber"
                : "notice notice-blue"
          } style={{ marginBottom: 12 }}>
            {packet.integrity.status === "verified" ? <CheckCircle2 size={15} /> : <ShieldCheck size={15} />}
            <span>
              <strong>
                {packet.integrity.status === "verified"
                  ? "Sealed review evidence verified."
                  : packet.integrity.status === "mismatch"
                    ? "Evidence integrity mismatch — do not rely on this packet until investigated."
                    : "Review evidence is not sealed yet."}
              </strong>
              {" "}
              Current SHA-256 <span className="mono">{compactHash(packet.integrity.currentSha256)}</span>
              {packet.integrity.sealedSha256
                ? <> · sealed <span className="mono">{compactHash(packet.integrity.sealedSha256)}</span></>
                : null}
            </span>
          </div>

          <div className="run-stats" style={{ margin: "0 0 12px" }}>
            <div>
              <span>Rationale</span>
              <strong style={{ fontSize: 13 }}>{packet.decision.reason}</strong>
              <small>requested by {packet.decision.requestedBy}</small>
            </div>
            <div>
              <span>Manager attestations</span>
              <strong style={{ fontSize: 13 }}>{managerAttestations.length}</strong>
              <small>reporting-line bound</small>
            </div>
            <div>
              <span>Attachments</span>
              <strong style={{ fontSize: 13 }}>{attachments.length}</strong>
              <small>content-hashed documents</small>
            </div>
            <div>
              <span>Approval</span>
              <strong style={{ fontSize: 13 }}>{packet.decision.approvedBy ?? "Pending"}</strong>
              <small>{packet.integrity.sealedAt ? new Date(packet.integrity.sealedAt).toLocaleString() : "not sealed"}</small>
            </div>
          </div>

          {managerAttestations.length > 0 && (
            <div className="data-table-wrap" style={{ marginBottom: 12 }}>
              <table className="data-table">
                <thead><tr><th>MANAGER</th><th>RECOMMENDATION</th><th>STATEMENT</th><th>SUBMITTED</th></tr></thead>
                <tbody>
                  {managerAttestations.map((attestation) => (
                    <tr key={attestation.id}>
                      <td><strong>{attestation.managerName}</strong><small style={{ display: "block", color: "var(--muted)" }}>Employee #{attestation.managerEmployeeId}</small></td>
                      <td>{readable(attestation.recommendation)}</td>
                      <td style={{ maxWidth: 420 }}>{attestation.statement}</td>
                      <td>{new Date(attestation.createdAt).toLocaleString("en-PH")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {payload?.canContribute && (
            <>
              {payload.managerReviewOnly ? (
                <form onSubmit={submitManagerAttestation} style={{ marginBottom: 12 }}>
                  <div className="notice notice-blue" style={{ marginBottom: 10 }}>
                    <ShieldCheck size={15} />
                    <span>Your attestation is bound to the worker's current reporting line and becomes immutable evidence for this decision. It does not approve the decision.</span>
                  </div>
                  <div className="setting-form">
                    <label>Manager recommendation
                      <select value={managerRecommendation} onChange={(event) => setManagerRecommendation(event.target.value)}>
                        <option value="support">Support proposed decision</option>
                        <option value="do_not_support">Do not support proposed decision</option>
                        <option value="needs_more_review">Needs more review</option>
                      </select>
                    </label>
                    <label>Manager attestation
                      <textarea
                        required
                        minLength={20}
                        maxLength={4000}
                        value={managerStatement}
                        onChange={(event) => setManagerStatement(event.target.value)}
                        placeholder="Record the observations and facts supporting your recommendation."
                      />
                    </label>
                  </div>
                  <div className="run-actions">
                    <button className="secondary-button" disabled={busy || managerStatement.trim().length < 20}>
                      Submit immutable attestation
                    </button>
                  </div>
                </form>
              ) : (
              <form onSubmit={addNote} style={{ marginBottom: 12 }}>
                <div className="setting-form">
                  <label>Review note type
                    <select
                      value={noteKind}
                      onChange={(event) => setNoteKind(event.target.value)}
                    >
                      <option value="hr_review">HR review</option>
                      <option value="decision_rationale">Decision rationale</option>
                      <option value="other">Other evidence note</option>
                    </select>
                  </label>
                  <label>Review note
                    <textarea
                      required
                      minLength={3}
                      maxLength={4000}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Record the facts reviewed, observations, recommendation, or rationale."
                    />
                  </label>
                </div>
                <div className="run-actions">
                  <button className="secondary-button" disabled={busy || note.trim().length < 3}>
                    Add immutable note
                  </button>
                </div>
              </form>
              )}

              <form onSubmit={uploadEvidence} style={{ marginBottom: 12 }}>
                <div className="setting-form">
                  <label>Evidence type
                    <select value={evidenceKind} onChange={(event) => setEvidenceKind(event.target.value)}>
                      <option value="probation_evaluation">Probation evaluation</option>
                      <option value="performance_review">Performance review</option>
                      <option value="contract">Contract</option>
                      <option value="manager_recommendation">Manager recommendation</option>
                      <option value="other">Other supporting evidence</option>
                    </select>
                  </label>
                  <label>Evidence label
                    <input
                      required
                      minLength={2}
                      maxLength={180}
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder="e.g. 5-month probation evaluation"
                    />
                  </label>
                  <label>Supporting file
                    <input
                      required
                      type="file"
                      accept={accepted}
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                <div className="run-actions">
                  <button className="secondary-button" disabled={busy || !file || label.trim().length < 2}>
                    <Paperclip size={13} /> Attach evidence
                  </button>
                </div>
                <div className="modal-note" style={{ marginTop: 8 }}>
                  PDF, PNG, or JPEG only. Files are content-sniffed, malware-scanned, SHA-256 hashed, and cannot be detached from a sealed decision packet.
                </div>
              </form>
            </>
          )}

          {notes.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="card-kicker" style={{ marginBottom: 6 }}>REVIEW NOTES</div>
              {notes.map((item) => (
                <div className="payslip-line" key={item.id} style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>
                    {item.content}
                    <em>{readable(item.noteKind)} · {item.createdByName} · {new Date(item.createdAt).toLocaleString()}</em>
                  </span>
                  <b>#{item.id}</b>
                </div>
              ))}
            </div>
          )}

          {attachments.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="card-kicker" style={{ marginBottom: 6 }}>SUPPORTING FILES</div>
              {attachments.map((item) => (
                <div className="payslip-line" key={item.id} style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>
                    {item.label}
                    <em>
                      {readable(item.evidenceKind)} · {item.fileName} · {(item.byteSize / 1024).toFixed(1)} KB · SHA {compactHash(item.sha256)}
                    </em>
                  </span>
                  <a className="secondary-button" href={`/api/documents/${item.documentId}`} target="_blank" rel="noreferrer">
                    <FileCheck2 size={13} /> View
                  </a>
                </div>
              ))}
            </div>
          )}

          {timeline.length > 0 && (
            <div>
              <div className="card-kicker" style={{ marginBottom: 6 }}>APPROVAL &amp; LIFECYCLE HISTORY</div>
              {timeline.slice().reverse().slice(0, compact ? 8 : 20).map((event) => (
                <div className="payslip-line" key={event.id} style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>
                    {readable(event.eventType)}
                    <em>{event.actorName} · {new Date(event.createdAt).toLocaleString()}</em>
                  </span>
                  <b>#{event.id}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

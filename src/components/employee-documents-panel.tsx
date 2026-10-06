"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Clock3,
  FileCheck2,
  FileText,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

type PolicyAssignment = {
  assignmentId: number;
  status: string;
  assignedAt: string;
  dueAt: string | null;
  acknowledgedAt: string | null;
  acknowledgementSha256: string | null;
  waivedAt: string | null;
  waiverReason: string | null;
  policyId: number;
  policyCode: string;
  title: string;
  category: string;
  version: string;
  policyStatus: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  requiresAcknowledgement: boolean;
  content: string;
  contentSha256: string;
  approvedByName: string | null;
  approvedAt: string | null;
  overdue: boolean;
};

type DocumentRequirement = {
  complianceId: number;
  status: string;
  dueAt: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  waiverReason: string | null;
  requirementId: number;
  code: string;
  name: string;
  kind: string;
  mandatory: boolean;
  expiryRequired: boolean;
  renewalLeadDays: number;
  documentId: number | null;
  fileName: string | null;
  scannedClean: boolean | null;
  uploadedAt: string | null;
};

type Payload = {
  policies: PolicyAssignment[];
  documentRequirements: DocumentRequirement[];
  summary: {
    acknowledgementRequired: number;
    overdueAcknowledgements: number;
    missingDocuments: number;
    submittedDocuments: number;
    expiringDocuments: number;
    expiredDocuments: number;
  };
};

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(
    new Date(value.length === 10 ? value + "T00:00:00+08:00" : value),
  );
}

function statusTone(status: string) {
  if (["acknowledged", "current", "verified", "not_required"].includes(status)) return "good";
  if (["expired", "overdue"].includes(status)) return "bad";
  if (["assigned", "submitted", "expiring", "missing"].includes(status)) return "warn";
  return "neutral";
}

export function EmployeeDocumentsPanel({ organizationId }: { organizationId: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [requirementId, setRequirementId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/self/documents", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load documents.");
      setData(payload as Payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load documents.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedRequirement = useMemo(
    () => data?.documentRequirements.find((row) => row.complianceId === Number(requirementId)) ?? null,
    [data, requirementId],
  );

  async function acknowledge(assignment: PolicyAssignment) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/self/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "acknowledge-policy",
          assignmentId: assignment.assignmentId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not acknowledge policy.");
      setConfirmed((current) => {
        const next = new Set(current);
        next.delete(assignment.assignmentId);
        return next;
      });
      await load();
    } catch (ackError) {
      setError(ackError instanceof Error ? ackError.message : "Could not acknowledge policy.");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!file || !selectedRequirement) return;
    if (selectedRequirement.expiryRequired && !expiresAt) {
      setError("This document requires an expiry date.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("organizationId", String(organizationId));
      form.set("requirementId", String(selectedRequirement.requirementId));
      form.set("kind", selectedRequirement.kind);
      form.set("file", file);
      if (expiresAt) form.set("expiresAt", expiresAt);

      const response = await fetch("/api/documents", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not upload document.");

      setFile(null);
      setExpiresAt("");
      setRequirementId("");
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload document.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <section className="employee-section">
        <div className="employee-empty-row">{error || "Loading your documents and policies…"}</div>
      </section>
    );
  }

  const openRequirements = data.documentRequirements.filter((row) =>
    ["missing", "submitted", "expiring", "expired"].includes(row.status),
  );

  return (
    <section className="employee-section">
      <header className="employee-section-heading">
        <div>
          <span className="card-kicker">MY DOCUMENTS</span>
          <h2>Policies &amp; required documents</h2>
          <p>Read the exact policy version assigned to you, acknowledge it yourself, and keep required employee documents current.</p>
        </div>
      </header>

      {error && <div className="notice notice-amber"><AlertTriangle size={15} /><span>{error}</span></div>}

      <div className="employee-leave-balances">
        <article>
          <span>Policy acknowledgements</span>
          <strong>{data.summary.acknowledgementRequired}</strong>
          <small>{data.summary.overdueAcknowledgements} overdue</small>
        </article>
        <article>
          <span>Missing documents</span>
          <strong>{data.summary.missingDocuments}</strong>
          <small>{data.summary.submittedDocuments} awaiting HR verification</small>
        </article>
        <article>
          <span>Renewal attention</span>
          <strong>{data.summary.expiringDocuments + data.summary.expiredDocuments}</strong>
          <small>{data.summary.expiringDocuments} expiring · {data.summary.expiredDocuments} expired</small>
        </article>
      </div>

      <article className="employee-list-card">
        <div className="employee-list-card-head">
          <div><span className="card-kicker">POLICIES</span><h3>Assigned policy versions</h3></div>
          <ShieldCheck size={17} />
        </div>
        {data.policies.length === 0 ? (
          <div className="employee-empty-row">No policy versions are assigned to you.</div>
        ) : data.policies.map((policy) => (
          <div key={policy.assignmentId} style={{ borderBottom: "1px solid var(--border)", padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <strong>{policy.title}</strong>
                <span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>
                  {policy.policyCode} · version {policy.version} · effective {dateLabel(policy.effectiveFrom)}
                  {policy.dueAt ? ` · due ${dateLabel(policy.dueAt)}` : ""}
                </span>
              </div>
              <span className={"employee-status-pill " + statusTone(policy.overdue ? "overdue" : policy.status)}>
                {policy.overdue ? "Overdue" : policy.status.replaceAll("_", " ")}
              </span>
            </div>

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                <BookOpen size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
                Read policy version
              </summary>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, marginTop: 12, padding: 14, borderRadius: 10, background: "var(--surface-soft)" }}>
                {policy.content}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                Content evidence: SHA-256 {policy.contentSha256.slice(0, 16)}… · approved by {policy.approvedByName ?? "HR"}
              </div>
            </details>

            {policy.status === "assigned" && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={confirmed.has(policy.assignmentId)}
                    onChange={(event) => {
                      setConfirmed((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(policy.assignmentId);
                        else next.delete(policy.assignmentId);
                        return next;
                      });
                    }}
                  />
                  <span>I acknowledge that I have received and read this exact policy version.</span>
                </label>
                <button
                  className="primary-button brand"
                  style={{ marginTop: 10 }}
                  disabled={busy || !confirmed.has(policy.assignmentId)}
                  onClick={() => void acknowledge(policy)}
                >
                  <Check size={14} /> Acknowledge policy
                </button>
              </div>
            )}

            {policy.status === "acknowledged" && (
              <div className="notice notice-green" style={{ marginTop: 12 }}>
                <FileCheck2 size={15} />
                <span>Acknowledged {dateLabel(policy.acknowledgedAt)}. Evidence hash {policy.acknowledgementSha256?.slice(0, 16)}…</span>
              </div>
            )}
          </div>
        ))}
      </article>

      <article className="employee-list-card" style={{ marginTop: 16 }}>
        <div className="employee-list-card-head">
          <div><span className="card-kicker">REQUIRED DOCUMENTS</span><h3>Compliance checklist</h3></div>
          <FileText size={17} />
        </div>
        {data.documentRequirements.length === 0 ? (
          <div className="employee-empty-row">No employee documents are currently required.</div>
        ) : data.documentRequirements.map((row) => (
          <div className="employee-leave-row" key={row.complianceId}>
            <div>
              <strong>{row.name}</strong>
              <span>
                {row.documentId && row.fileName
                  ? <><a href={"/api/documents/" + row.documentId} target="_blank" rel="noreferrer">{row.fileName}</a></>
                  : "No file submitted"}
                {row.dueAt ? ` · due ${dateLabel(row.dueAt)}` : ""}
                {row.expiresAt ? ` · expires ${dateLabel(row.expiresAt)}` : ""}
              </span>
            </div>
            <span className={"employee-status-pill " + statusTone(row.status)}>{row.status}</span>
          </div>
        ))}
      </article>

      {openRequirements.length > 0 && (
        <article className="employee-edit-card" style={{ marginTop: 16 }}>
          <div>
            <span className="card-kicker">UPLOAD / RENEW</span>
            <h3 style={{ marginTop: 4 }}>Submit a required document</h3>
            <p style={{ marginTop: 4 }}>Your upload is malware-scanned and remains Submitted until HR verifies it.</p>
          </div>
          <div className="employee-edit-fields">
            <label>Requirement
              <select value={requirementId} onChange={(event) => { setRequirementId(event.target.value); setExpiresAt(""); }}>
                <option value="">Choose requirement</option>
                {openRequirements.map((row) => <option key={row.complianceId} value={row.complianceId}>{row.name} · {row.status}</option>)}
              </select>
            </label>
            <label>File
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            {selectedRequirement?.expiryRequired && (
              <label>Expiry date<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
            )}
          </div>
          <div className="employee-edit-actions">
            <button className="primary-button brand" disabled={busy || !selectedRequirement || !file} onClick={() => void upload()}>
              <UploadCloud size={14} /> {busy ? "Submitting…" : "Submit document"}
            </button>
          </div>
        </article>
      )}

      <div className="employee-privacy-note" style={{ marginTop: 16 }}>
        <Clock3 size={15} />
        <span>Policy acknowledgements are bound to your signed-in user, employee record, policy version, exact policy content hash and acknowledgement timestamp.</span>
      </div>
    </section>
  );
}

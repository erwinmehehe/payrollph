"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Download, FileCheck2, Info } from "lucide-react";
import type { Notify } from "./types";
import { Segmented, Status, formatDate } from "./ui";

type FilingRecord = {
  id: number;
  payrollRunId: number | null;
  agency: string;
  form: string;
  periodLabel: string;
  fileName: string;
  fileSha256: string;
  generatorVersion: string;
  status: "generated" | "accepted" | "rejected";
  submissionMethod: "file_upload" | "manual_entry" | null;
  agencyReference: string | null;
  submittedAt: string | null;
  outcomeNote: string | null;
  generatedBy: string;
  recordedBy: string | null;
  recordedAt: string | null;
  createdAt: string;
};

type FilingForm = {
  agency: string;
  form: string;
  generatorVersion: string;
  referenceLabel: string;
  copy: {
    title: string;
    agencyLabel: string;
    portalLabel: string;
    methodLabels: { file_upload: string; manual_entry: string };
    manualEntryNote: string;
    answerLabel: string;
    scopeNote: string | null;
    unconfirmedNote: string;
  };
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Records what an agency said about a file Linaw generated. The wording comes
 * from the form's definition on the server (src/lib/filing-evidence.ts), so the
 * claims on screen are reviewed with the rules that decide what counts. The three steps are on one
 * card on purpose: create the record, download exactly that file, then record
 * the answer. Only an accepted upload of the generated file turns the readiness
 * gate on, and the form says so before anyone clicks.
 */
export function FilingEvidencePanel({
  organizationId,
  agency,
  form,
  run,
  notify,
  onRefresh,
}: {
  organizationId: number;
  agency: string;
  form: string;
  run: { id: number; periodLabel: string };
  notify: Notify;
  onRefresh: () => Promise<void>;
}) {
  const [records, setRecords] = useState<FilingRecord[] | null>(null);
  const [definition, setDefinition] = useState<FilingForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [outcome, setOutcome] = useState<"accepted" | "rejected">("accepted");
  const [method, setMethod] = useState<"file_upload" | "manual_entry">("file_upload");
  const [reference, setReference] = useState("");
  const [submittedAt, setSubmittedAt] = useState(todayInput);
  const [note, setNote] = useState("");

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let active = true;
    fetch(`/api/compliance/filing-validations?organizationId=${organizationId}`, { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, payload: await response.json().catch(() => ({})) }))
      .then(({ ok, payload }) => {
        if (!active) return;
        if (!ok) {
          setLoadError(payload.error ?? "Filing records could not be loaded.");
          setRecords([]);
          return;
        }
        setLoadError(null);
        setRecords(payload.records ?? []);
        setDefinition((payload.forms ?? []).find((item: FilingForm) => item.agency === agency && item.form === form) ?? null);
      })
      .catch(() => {
        if (!active) return;
        setLoadError("Filing records could not be loaded because the server could not be reached.");
        setRecords([]);
      });
    return () => {
      active = false;
    };
  }, [organizationId, agency, form, reloadKey]);

  const forRun = (records ?? []).filter((item) => item.agency === agency && item.form === form && item.payrollRunId === run.id);
  const currentVersion = definition?.generatorVersion;
  const copy = definition?.copy;
  const agencyLabel = copy?.agencyLabel ?? agency;

  function reset() {
    setOutcome("accepted");
    setMethod("file_upload");
    setReference("");
    setSubmittedAt(todayInput());
    setNote("");
  }

  async function createRecord() {
    setCreating(true);
    try {
      const response = await fetch("/api/compliance/filing-validations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, runId: run.id, agency, form }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? `The ${agency} ${form} record could not be created.`, "err");
        return;
      }
      notify(
        payload.created
          ? `${agency} ${form} record created. Download that file, use it with ${copy?.portalLabel ?? agencyLabel}, then record the result here.`
          : "This exact file already has a record. Nothing was duplicated.",
        "ok",
      );
      reload();
      await onRefresh();
    } catch {
      notify("The record could not be created because the server could not be reached.", "err");
    } finally {
      setCreating(false);
    }
  }

  async function downloadFile(record: FilingRecord) {
    setDownloadingId(record.id);
    try {
      const response = await fetch(`/api/compliance/filing-validations/${record.id}/file?organizationId=${organizationId}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        notify(payload.error ?? `The file failed with status ${response.status}.`, "err");
        return;
      }
      const blob = await response.blob();
      const filename = (response.headers.get("content-disposition") ?? "").match(/filename="?([^";]+)"?/i)?.[1] ?? record.fileName;
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      notify("File downloaded. It is byte-for-byte the file this record was made for.", "info");
    } catch {
      notify("The file could not be downloaded because the server could not be reached.", "err");
    } finally {
      setDownloadingId(null);
    }
  }

  async function saveResult(record: FilingRecord) {
    if (outcome === "accepted" && reference.trim().length < 4) {
      notify(`Enter the reference ${agencyLabel} gave you before recording an acceptance.`, "err");
      return;
    }
    if (outcome === "rejected" && !note.trim()) {
      notify(`Say what ${agencyLabel} rejected, so the next attempt can fix it.`, "err");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/compliance/filing-validations/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          outcome,
          submissionMethod: method,
          agencyReference: reference.trim(),
          submittedAt: submittedAt || undefined,
          note: note.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "The result could not be recorded.", "err");
        if (response.status === 409) reload();
        return;
      }
      notify(
        outcome === "accepted"
          ? method === "file_upload"
            ? `Acceptance recorded. This counts toward the ${agency} ${form} readiness gate.`
            : "Filing recorded. Because the figures were typed in, it does not count as proof the generated file imports."
          : "Rejection recorded. Fix the cause, then create a new record for the corrected file.",
        "ok",
      );
      setOpenId(null);
      reset();
      reload();
      await onRefresh();
    } catch {
      notify("The result could not be recorded because the server could not be reached.", "err");
    } finally {
      setSaving(false);
    }
  }

  function evidenceLabel(record: FilingRecord) {
    if (record.status !== "accepted") return null;
    if (record.submissionMethod !== "file_upload") return { tone: "amber", text: "Recorded, but typed in by hand, so it does not prove the generated file works." };
    if (currentVersion && record.generatorVersion !== currentVersion) return { tone: "amber", text: "Accepted for an older file layout, so it no longer counts." };
    return { tone: "green", text: `Counts toward the ${agency} ${form} readiness gate.` };
  }

  return (
    <article className="card" data-filing-evidence style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">AGENCY EVIDENCE</div>
          <h2>{copy?.title ?? `${agency} ${form}`}</h2>
          <p>
            Linaw does not submit to {agencyLabel}. This keeps proof of what happened when you did: the exact file, the
            reference {agencyLabel} gave you, and who recorded it.
          </p>
        </div>
        <FileCheck2 size={18} className="i-teal" aria-hidden />
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 12 }}>
        <div className="notice notice-blue" style={{ margin: 0 }}>
          <Info size={15} className="i-blue" />
          <span>
            Only an accepted <strong>use of the file Linaw generated</strong> turns the readiness gate on.{" "}
            {copy?.manualEntryNote} {copy?.unconfirmedNote}
          </span>
        </div>

        {copy?.scopeNote && (
          <div className="notice notice-amber" style={{ margin: 0 }}>
            <AlertTriangle size={15} className="i-amber" />
            <span>{copy.scopeNote}</span>
          </div>
        )}

        {loadError && (
          <div className="notice notice-red" style={{ margin: 0 }}>
            <AlertTriangle size={15} className="i-red" />
            <span>{loadError}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="secondary-button" disabled={creating || records === null} onClick={() => void createRecord()}>
            <FileCheck2 size={14} className="i-teal" />
            {creating ? "Creating record…" : `Create ${agency} ${form} record for ${run.periodLabel}`}
          </button>
          <small className="field-help" style={{ margin: 0 }}>
            Uses this run&apos;s data as it is now. Creating it again with unchanged data returns the same record.
          </small>
        </div>

        {records !== null && forRun.length === 0 && !loadError && (
          <p className="field-help" style={{ margin: 0 }}>No {agency} {form} records for this run yet.</p>
        )}

        {forRun.map((record) => {
          const evidence = evidenceLabel(record);
          const isOpen = openId === record.id;
          return (
            <div key={record.id} className="leave-request" data-filing-record={record.id} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{record.fileName}</strong>
                  <p style={{ margin: "2px 0 0" }}>
                    Created {formatDate(record.createdAt)} by {record.generatedBy} · file fingerprint{" "}
                    <code title={record.fileSha256}>{record.fileSha256.slice(0, 12)}</code>
                  </p>
                </div>
                <Status value={record.status === "generated" ? "Pending" : record.status === "accepted" ? "Accepted" : "Rejected"} />
              </div>

              {record.status === "generated" && (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="secondary-button" disabled={downloadingId === record.id} onClick={() => void downloadFile(record)}>
                      <Download size={14} className="i-teal" />
                      {downloadingId === record.id ? "Preparing…" : "1. Download this file"}
                    </button>
                    <button
                      className={isOpen ? "secondary-button" : "primary-button brand"}
                      onClick={() => {
                        reset();
                        setOpenId(isOpen ? null : record.id);
                      }}
                    >
                      <Check size={14} /> {isOpen ? "Cancel" : `2. Record ${agencyLabel}'s answer`}
                    </button>
                  </div>

                  {isOpen && (
                    <div style={{ display: "grid", gap: 10 }}>
                      <Segmented
                        label={`What ${agencyLabel} said`}
                        value={outcome}
                        onChange={setOutcome}
                        options={[
                          { value: "accepted", label: "Accepted" },
                          { value: "rejected", label: "Rejected" },
                        ]}
                      />
                      <label className="field">
                        <span>How it was submitted</span>
                        <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
                          <option value="file_upload">{copy?.methodLabels.file_upload}</option>
                          <option value="manual_entry">{copy?.methodLabels.manual_entry}</option>
                        </select>
                      </label>
                      {outcome === "accepted" ? (
                        <>
                          <label className="field">
                            <span>{copy?.answerLabel ?? "Agency reference"}</span>
                            <input
                              value={reference}
                              onChange={(event) => setReference(event.target.value)}
                              placeholder={`Copy it exactly as ${agencyLabel} gave it to you`}
                              maxLength={60}
                            />
                          </label>
                          <label className="field">
                            <span>Date submitted</span>
                            <input type="date" value={submittedAt} max={todayInput()} onChange={(event) => setSubmittedAt(event.target.value)} />
                          </label>
                          <label className="field">
                            <span>Note (optional)</span>
                            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
                          </label>
                        </>
                      ) : (
                        <label className="field">
                          <span>What did {agencyLabel} reject, and why?</span>
                          <textarea
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            maxLength={2000}
                            placeholder={`Paste the error message or the field ${agencyLabel} did not accept`}
                          />
                        </label>
                      )}
                      <div>
                        <button className="primary-button brand" disabled={saving} onClick={() => void saveResult(record)}>
                          {saving ? "Recording…" : outcome === "accepted" ? "Record acceptance" : "Record rejection"}
                        </button>
                        <p className="field-help">
                          This is a permanent, audited entry and cannot be edited afterwards. Record an acceptance only if
                          {agencyLabel} actually gave you one; Linaw cannot check {agencyLabel} for you. If you are asked to confirm your identity,
                          that is the usual extra check for sensitive payroll actions.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {record.status !== "generated" && (
                <div style={{ display: "grid", gap: 4 }}>
                  <p style={{ margin: 0 }}>
                    {record.status === "accepted" ? "Accepted" : "Rejected"}
                    {record.submissionMethod && copy ? ` · ${copy.methodLabels[record.submissionMethod].toLowerCase()}` : ""}
                    {record.agencyReference ? ` · reference ${record.agencyReference}` : ""}
                    {record.submittedAt ? ` · submitted ${formatDate(record.submittedAt)}` : ""}
                    {record.recordedBy ? ` · recorded by ${record.recordedBy}` : ""}
                  </p>
                  {record.outcomeNote && <p style={{ margin: 0 }}>{record.outcomeNote}</p>}
                  {evidence && (
                    <small className={evidence.tone === "green" ? "green-number" : "field-help"} style={{ margin: 0 }}>
                      {evidence.text}
                    </small>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

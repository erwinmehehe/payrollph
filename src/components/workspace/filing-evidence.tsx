"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Download, FileCheck2, Info } from "lucide-react";
import type { Notify } from "./types";
import { Segmented, Status, formatDate } from "./ui";
import { EntityBadge } from "./multi-entity-ui";
import type { DashboardData } from "./types";
import { parseFilingValidationRead, type FilingRecord, type FilingForm } from "@/lib/filing-validation-read";

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function isMonthEnd(value?: string) {
  if (!value) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Records what an agency said about a file Linaw generated. The wording comes
 * from the form's definition on the server (src/lib/filing-evidence.ts), so the
 * claims on screen are reviewed with the rules that decide what counts. The three steps are on one
 * card on purpose: create the record, download the exact worksheet, then record
 * the agency answer. Each filing definition says whether readiness requires
 * file-format acceptance or operational portal acknowledgement.
 */
export function FilingEvidencePanel({
  organizationId,
  agency,
  form,
  run,
  entityContext,
  notify,
  onRefresh,
}: {
  organizationId: number;
  agency: string;
  form: string;
  run: { id: number; periodLabel: string; periodEnd?: string; legalEntityId?: number | null };
  entityContext?: DashboardData["multiEntity"];
  notify: Notify;
  onRefresh: () => Promise<void>;
}) {
  const [observation, setObservation] = useState<{
    scopeKey: string;
    records: FilingRecord[] | null;
    definition: FilingForm | null;
    error: string | null;
  } | null>(null);
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
  // Invalidate any previous tenant/run/form read synchronously during render.
  const currentScopeKey = JSON.stringify({
    organizationId, legalEntityId: run.legalEntityId ?? null,
    runId: run.id, agency, form, reloadKey, entityEnabled: Boolean(entityContext?.enabled),
  });
  const currentRead = observation?.scopeKey === currentScopeKey ? observation : null;
  const records = currentRead?.records ?? null;
  const definition = currentRead?.definition ?? null;
  const loadError = currentRead?.error ?? null;
  const verifiedRead = records !== null && definition !== null && loadError === null;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const requestKey = currentScopeKey;
    const employerId = run.legalEntityId ?? null;
    setObservation(null);

    if (typeof employerId !== "number" || !Number.isSafeInteger(employerId) || employerId <= 0) {
      setObservation({
        scopeKey: requestKey, records: null, definition: null,
        error: "This payroll run has no verified legal employer. Filing actions are unavailable.",
      });
      return () => { active = false; controller.abort(); };
    }

    void fetch(
      "/api/compliance/filing-validations?organizationId=" + organizationId + "&legalEntityId=" + employerId,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error("Filing records could not be loaded for this employer.");
        return payload;
      })
      .then((payload) => {
        if (!active || controller.signal.aborted) return;
        const verified = parseFilingValidationRead(payload, {
          organizationId, legalEntityId: employerId, agency, form,
        });
        if (!verified) throw new Error("Filing evidence is incomplete or does not belong to the selected legal employer.");
        setObservation({
          scopeKey: requestKey, records: verified.records, definition: verified.definition, error: null,
        });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setObservation({
          scopeKey: requestKey, records: null, definition: null,
          error: error instanceof Error ? error.message : "Filing evidence could not be verified.",
        });
      });

    return () => { active = false; controller.abort(); };
  }, [currentScopeKey, organizationId, agency, form, run.legalEntityId]);

  const forRun = (verifiedRead ? records : []).filter((item) => item.agency === agency && item.form === form && item.payrollRunId === run.id);
  const currentVersion = definition?.generatorVersion;
  const copy = definition?.copy;
  const agencyLabel = copy?.agencyLabel ?? agency;
  const official = definition?.official;
  const retiredBirAlphalistSource = agency === "BIR" && form === "1604-C";
  const allowedMethods = definition?.submissionMethods?.length
    ? definition.submissionMethods
    : ["file_upload", "manual_entry"] as const;
  const finalCutoffRequired = definition?.requiresFinalCutoff === true;
  const isFinalCutoff = !finalCutoffRequired || isMonthEnd(run.periodEnd);

  function reset() {
    setOutcome("accepted");
    setMethod(allowedMethods[0] ?? "manual_entry");
    setReference("");
    setSubmittedAt(todayInput());
    setNote("");
  }

  async function createRecord() {
    if (!verifiedRead) return;
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
    if (!verifiedRead) return;
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
    if (!verifiedRead) return;
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
      const countsOperationally = definition?.evidenceMode === "operational" && allowedMethods.includes(method);
      notify(
        outcome === "accepted"
          ? countsOperationally
            ? `Agency acknowledgement recorded. This counts as operational ${agency} ${form} filing evidence, not proof of an upload-file format.`
            : method === "file_upload"
              ? `Acceptance recorded. This counts toward the ${agency} ${form} file-format readiness gate.`
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
    if (retiredBirAlphalistSource) {
      return { tone: "amber", text: "Historical BIR Alphalist source evidence only. This does not count as current ADES file-format approval or filing acceptance." };
    }
    if (currentVersion && record.generatorVersion !== currentVersion) {
      return { tone: "amber", text: "Accepted for an older generator version, so it no longer counts toward current readiness." };
    }
    if (definition?.evidenceMode === "operational" && allowedMethods.includes(record.submissionMethod as "file_upload" | "manual_entry")) {
      return { tone: "green", text: `Counts as operational ${agency} ${form} filing evidence. It does not certify the generated file as an agency upload format.` };
    }
    if (record.submissionMethod !== "file_upload") {
      return { tone: "amber", text: "Recorded, but typed in by hand, so it does not prove the generated file works." };
    }
    return { tone: "green", text: `Counts toward the ${agency} ${form} file-format readiness gate.` };
  }

  return (
    <article className="card" data-filing-evidence style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">AGENCY EVIDENCE</div>
          <h2>{copy?.title ?? `${agency} ${form}`}</h2>
          {entityContext?.enabled && <EntityBadge context={entityContext} legalEntityId={run.legalEntityId} />}
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
            {retiredBirAlphalistSource ? (
              <>Legacy per-run Alphalist source records are retained for audit only. Prepare current annual data in Compliance - Year-End Annualization. Official BIR ADES validation and filing acceptance remain separate.</>
            ) : !verifiedRead ? (
              <>Filing status is unavailable until the selected employer's evidence has been verified.</>
            ) : definition?.evidenceMode === "operational" ? (
              <>
                An accepted filing with the agency&apos;s own acknowledgement can satisfy the <strong>operational filing</strong> gate.
                That does not certify the PayrollPH worksheet as an agency upload format.{" "}
              </>
            ) : (
              <>Only an accepted <strong>use of the file PayrollPH generated</strong> turns the file-format readiness gate on.{" "}</>
            )}
            {copy?.manualEntryNote} {copy?.unconfirmedNote}
          </span>
        </div>

        {official && (
          <section className="notice notice-slate" data-official-filing-path style={{ margin: 0, display: "block" }}>
            <strong>Official agency submission: {official.workflow}</strong>
            <p style={{ fontSize: 12, margin: "6px 0" }}>
              {official.notes} The government acceptance evidence to retain is: {official.acceptanceEvidence}
            </p>
            <strong style={{ display: "block", fontSize: 12, marginTop: 10 }}>External pilot acceptance checklist</strong>
            <ul style={{ margin: "5px 0 10px", paddingLeft: 20, fontSize: 12 }}>
              {official.acceptanceChecklist.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p style={{ fontSize: 12, margin: "5px 0 10px" }}>
              An operator-entered agency reference records a claim of acceptance. PayrollPH has not independently
              verified the underlying agency receipt, final member posting or file-import compatibility.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <a href={official.officialInstructionsUrl} target="_blank" rel="noopener noreferrer">Official filing instructions</a>
              <a href={official.officialPortalUrl} target="_blank" rel="noopener noreferrer">Open agency website</a>
            </div>
          </section>
        )}

        {definition?.relatedCertificate && (
          <section className="notice notice-slate" data-separate-bir-2316 style={{ margin: 0, display: "block" }}>
            <strong>BIR Form 2316: separate employee certificate</strong>
            <p style={{ fontSize: 12, margin: "6px 0" }}>{definition.relatedCertificate.notes}</p>
            <ul style={{ margin: "5px 0 10px", paddingLeft: 20, fontSize: 12 }}>
              {definition.relatedCertificate.acceptanceChecklist.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <a href={definition.relatedCertificate.officialInstructionsUrl} target="_blank" rel="noopener noreferrer">
              View official BIR Form 2316
            </a>
          </section>
        )}

        {copy?.scopeNote && (
          <div className="notice notice-amber" style={{ margin: 0 }}>
            <AlertTriangle size={15} className="i-amber" />
            <span>{copy.scopeNote}</span>
          </div>
        )}

        {loadError && (
          <div className="notice notice-red" style={{ margin: 0 }} role="alert">
            <AlertTriangle size={15} className="i-red" />
            <span>{loadError} Filing actions are locked until a verified reload succeeds.</span>
            <button className="secondary-button" type="button" onClick={reload}>
              Retry evidence read
            </button>
          </div>
        )}
        {!verifiedRead && !loadError && (
          <div className="notice notice-slate" role="status" style={{ margin: 0 }}>
            Verifying filing records and legal employer before enabling actions…
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="secondary-button"
            disabled={creating || !verifiedRead || !isFinalCutoff || retiredBirAlphalistSource}
            onClick={() => void createRecord()}
          >
            <FileCheck2 size={14} className="i-teal" />
            {creating ? "Creating record…" : `Create ${agency} ${form} record for ${run.periodLabel}`}
          </button>
          <small className="field-help" style={{ margin: 0 }}>
            {retiredBirAlphalistSource
              ? "Legacy 1604-C source generation is retired. Open Compliance - Year-End Annualization and run Check BIR source instead."
              : !isFinalCutoff
                ? "This monthly filing record must be created from the final cutoff of the month."
                : "Uses this run's data as it is now. Creating it again with unchanged data returns the same record."}
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
                  {record.applicableMonth && record.employeeCount != null && record.reportedTotal != null && (
                    <p style={{ margin: "2px 0 0" }}>
                      Monthly snapshot · {record.applicableMonth} · {record.employeeCount} employees · ₱{Number(record.reportedTotal).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  )}
                </div>
                <Status value={record.status === "generated" ? "Pending" : record.status === "accepted" ? "Accepted" : "Rejected"} />
              </div>

              {record.status === "generated" && !retiredBirAlphalistSource && (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="secondary-button" disabled={!verifiedRead || downloadingId === record.id} onClick={() => void downloadFile(record)}>
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
                          {allowedMethods.map((submissionMethod) => (
                            <option key={submissionMethod} value={submissionMethod}>
                              {copy?.methodLabels[submissionMethod]}
                            </option>
                          ))}
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
                        <button className="primary-button brand" disabled={!verifiedRead || saving} onClick={() => void saveResult(record)}>
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

              {retiredBirAlphalistSource && record.status === "generated" && (
                <p className="field-help">Historical per-run source retained. New acceptance cannot be recorded against this obsolete workflow.</p>
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

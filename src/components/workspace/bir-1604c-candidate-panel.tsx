"use client";

import { useEffect, useState } from "react";
import { readVerifiedBirModuleEvidence, type VerifiedBirModuleEvidence } from "@/lib/bir-1604c-module-read";

type Issue = { code: string; message: string; employeeNo?: string; field?: string };
type Preview = {
  status: string; fileName: string; fileSha256: string;
  sourceDigest: string; recordCount: number;
};
type ModuleEvidence = VerifiedBirModuleEvidence;
type Props = {
  organizationId: number; legalEntityId: number; taxYear: number;
  sourceDigest: string | null; setNotice: (message: string) => void;
};

const formStyle = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", minWidth: 0, gap: 8 } as const;
const labelStyle = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", minWidth: 0, gap: 4, fontSize: 12 } as const;
const endpoint = "/api/bir/annual-employer/module-evidence";

export function Bir1604cCandidatePanel(props: Props & { enabled?: boolean }) {
  // Scope/source changes discard old files, previews and validation claims.
  const scopeKey = [props.organizationId, props.legalEntityId, props.taxYear, props.sourceDigest ?? ""].join(":");
  return props.enabled === true ? <EnabledBir1604cCandidatePanel key={scopeKey} {...props} /> : null;
}

function EnabledBir1604cCandidatePanel({
  organizationId, legalEntityId, taxYear, sourceDigest, setNotice,
}: Props) {
  const [reviewFile, setReviewFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [evidence, setEvidence] = useState<ModuleEvidence | null>(null);
  const [evidenceReadPhase, setEvidenceReadPhase] = useState<"loading" | "verified" | "unavailable">("loading");
  const [evidenceReadError, setEvidenceReadError] = useState("");
  const [version, setVersion] = useState<"7.0" | "7.4">("7.0");
  const [result, setResult] = useState<"pass" | "fail">("pass");
  const [fileSha, setFileSha] = useState("");
  const [validatedOn, setValidatedOn] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [observationId, setObservationId] = useState("");
  const [reviewReference, setReviewReference] = useState("");
  const [reviewDecision, setReviewDecision] = useState<"confirmed" | "rejected">("confirmed");
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  async function refreshEvidence() {
    setEvidence(null);
    setEvidenceReadPhase("loading");
    setEvidenceReadError("");
    try {
      const verified = await readVerifiedBirModuleEvidence(
        { organizationId, legalEntityId, taxYear, sourceDigest }, fetch,
      );
      setEvidence(verified);
      setEvidenceReadPhase("verified");
    } catch (caught) {
      setEvidence(null);
      setEvidenceReadPhase("unavailable");
      setEvidenceReadError(caught instanceof Error ? caught.message : "BIR evidence unavailable.");
      throw caught;
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const scope = { organizationId, legalEntityId, taxYear, sourceDigest };
    void readVerifiedBirModuleEvidence(scope, fetch, controller.signal)
      .then((verified) => {
        if (controller.signal.aborted) return;
        setEvidence(verified);
        setEvidenceReadPhase("verified");
        setEvidenceReadError("");
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setEvidence(null);
        setEvidenceReadPhase("unavailable");
        setEvidenceReadError(caught instanceof Error ? caught.message : "BIR evidence unavailable.");
      });
    return () => controller.abort();
  }, [organizationId, legalEntityId, taxYear, sourceDigest]);

  async function downloadTemplate() {
    if (!legalEntityId || !sourceDigest) {
      setNotice("Reconcile the selected legal employer before downloading a review worksheet.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/bir/annual-employer/candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "template", organizationId, legalEntityId, taxYear,
          sourceDigest, records: [],
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        setNotice(failure.error ?? "BIR review worksheet download is blocked.");
        return;
      }
      const file = await response.blob();
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = "BIR-1604C-REVIEW-" + taxYear + "-EMPLOYER-" + legalEntityId + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Private review worksheet downloaded. Every null is a missing evidence-backed BIR field, not a zero.");
    } catch {
      setNotice("Could not download the reviewed BIR source worksheet.");
    } finally {
      setLoading(false);
    }
  }

  async function submitCandidate(mode: "check" | "download") {
    if (!reviewFile || !sourceDigest || !legalEntityId) {
      setNotice("Reconcile the legal employer first and select a reviewed JSON schedule file.");
      return;
    }
    if (reviewFile.size > 2 * 1024 * 1024) {
      setNotice("Reviewed source exceeds the 2 MiB upload limit."); return;
    }
    setLoading(true);
    if (mode === "check") { setPreview(null); setIssues([]); }
    try {
      const parsed: unknown = JSON.parse(await reviewFile.text());
      const uploaded = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
      if (!Array.isArray(uploaded.records)) {
        setNotice("Reviewed JSON must contain an array of records with all required D1/D2 fields.");
        return;
      }
      const response = await fetch("/api/bir/annual-employer/candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, organizationId, legalEntityId, taxYear, sourceDigest,
          records: uploaded.records,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setIssues(Array.isArray(payload.issues) ? payload.issues as Issue[] : []);
        if (mode === "download") setPreview(null);
        setNotice(payload.error ?? "BIR candidate is blocked. See employee-level issues.");
        return;
      }
      if (mode === "check") {
        const next = await response.json() as Preview;
        setPreview(next);
        setFileSha(next.fileSha256);
        setNotice("Local source and DAT checks passed. Official BIR module validation has NOT run.");
        return;
      }
      if (!preview || !globalThis.crypto?.subtle) {
        setNotice("Run the preview first using a browser that supports SHA-256 file verification.");
        return;
      }
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (sha !== preview.fileSha256 ||
          sha !== response.headers.get("X-BIR-File-SHA256") ||
          response.headers.get("X-BIR-Source-Digest") !== sourceDigest) {
        setPreview(null);
        setNotice("DAT bytes or source fingerprint changed after preview; no file was downloaded.");
        return;
      }
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = preview.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Draft DAT downloaded and hash-verified. Run the official BIR desktop validator before using any results.");
      void refreshEvidence();
    } catch {
      setNotice("Reviewed source could not be parsed or the candidate request failed. No DAT was downloaded.");
    } finally {
      setLoading(false);
    }
  }

  async function submitEvidence(mode: "observe" | "review") {
    if (!legalEntityId || !sourceDigest || evidenceReadPhase !== "verified" || !evidence || evidence.sourceDigest !== sourceDigest) {
      setNotice("BIR desktop validation evidence is unavailable. Retry the scoped evidence read before recording.");
      return;
    }
    setEvidenceLoading(true);
    try {
      const payload = mode === "observe" ? {
        mode, organizationId, legalEntityId, taxYear,
        sourceDigest: evidence?.sourceDigest ?? sourceDigest ?? "",
        fileSha256: fileSha.trim().toLowerCase(),
        moduleVersion: version, outcome: result,
        validatedOn, evidenceReference,
      } : {
        mode, organizationId, legalEntityId, taxYear,
        observationId: Number(observationId),
        decision: reviewDecision, evidenceReference: reviewReference,
      };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const output = await response.json().catch(() => null);
      if (!response.ok) {
        setNotice(output?.error ?? "BIR validation evidence was rejected.");
        return;
      }
      const receiptId = mode === "observe" ? output?.observationId : output?.reviewId;
      if (!Number.isSafeInteger(receiptId) || receiptId <= 0) {
        throw new Error("BIR evidence receipt was incomplete. Refresh to verify the saved state.");
      }
      await refreshEvidence();
      if (mode === "observe") {
        setObservationId(String(receiptId));
        setNotice("Module observation recorded (#" + String(receiptId) + "). A different authorized payroll operator must review its private evidence.");
      } else {
        setNotice("Independent review recorded. This is NOT an agency filing acceptance.");
      }
    } catch {
      setNotice("Could not verify the recorded BIR module evidence. Retry the read before acting.");
    } finally {
      setEvidenceLoading(false);
    }
  }

  return (
    <section className="notice notice-slate" aria-label="BIR 1604-C draft candidate and validator evidence"
      data-bir-1604c-candidate style={{ marginTop: 14, width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}>
      <div style={{ width: "100%", minWidth: 0, maxWidth: "100%", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", overflowWrap: "anywhere", gap: 12 }}>
        <h3 style={{ margin: 0 }}>1604-C reviewed DAT candidate (controlled test only)</h3>
        <p style={{ margin: 0 }}>
          Provide a private, independently reviewed JSON file containing a <code>records</code> array of
          complete D1/D2 fields, payroll employee numbers, prior-employer confirmation,
          and MWE premium evidence references where applicable. Missing fields and guessed zeroes are blocked.
          The feature is off by default and never files with BIR.
        </p>
        <button type="button" className="secondary-button" style={{ justifySelf: "start", maxWidth: "100%", whiteSpace: "normal", height: "auto", minHeight: 36, lineHeight: 1.35, textAlign: "left" }}
          disabled={!sourceDigest || !legalEntityId || loading}
          onClick={() => void downloadTemplate()}>
          Download prefilled review worksheet (unknown fields stay null)
        </button>
        <label style={labelStyle}>
          Reviewed schedule JSON (stays in this browser until you run the check)
          <input type="file" accept=".json,application/json" aria-label="Reviewed BIR schedule JSON" style={{ maxWidth: "100%", minWidth: 0 }}
            onChange={event => { setReviewFile(event.target.files?.[0] ?? null); setPreview(null); setIssues([]); }} />
        </label>
        <div className="heading-actions" style={{ flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="secondary-button"
            disabled={!sourceDigest || !reviewFile || loading}
            onClick={() => void submitCandidate("check")}>
            {loading ? "Checking…" : "Check reviewed DAT source"}
          </button>
          <button type="button" className="secondary-button"
            disabled={!preview || loading || !reviewFile || preview.sourceDigest !== sourceDigest}
            onClick={() => void submitCandidate("download")}>
            Download hash-verified draft DAT
          </button>
        </div>
        {!sourceDigest && <small>Run “Reconcile legal employer” above to bind the reviewed file to the current source fingerprint.</small>}
        {issues.length > 0 && <div role="alert" data-bir-candidate-blockers>
          <strong>{issues.length} blocking item(s)</strong>
          <ul style={{ paddingLeft: 18, marginTop: 6 }}>
            {issues.slice(0, 75).map((issue, index) =>
              <li key={index}>{issue.employeeNo ? issue.employeeNo + ": " : ""}
                {issue.field ? issue.field + " — " : ""}{issue.message}</li>)}
          </ul>
          {issues.length > 75 && <small>Only the first 75 blockers are shown; resolve them and recheck.</small>}
        </div>}
        {preview && <div role="status" data-bir-candidate-preview>
          <strong>Local preview: {preview.status}</strong>
          <p style={{ margin: "6px 0" }}>
            {preview.recordCount} employees · {preview.fileName} · SHA-256: <code style={{ overflowWrap: "anywhere" }}>{preview.fileSha256}</code>
          </p>
          <small>Official validator: not run. Matching exact bytes and approved employee data are still required.</small>
        </div>}
        <hr style={{ width: "100%", border: 0, borderTop: "1px solid var(--line)" }} />
        <h3 style={{ margin: 0 }}>BIR desktop validator evidence (independent review)</h3>
        {evidenceReadPhase !== "verified" ? (
          <p data-bir-v70-validation-status role={evidenceReadPhase === "unavailable" ? "alert" : "status"} style={{ margin: 0 }}>
            {evidenceReadPhase === "loading"
              ? "Checking BIR desktop module evidence for the selected employer…"
              : "BIR desktop validator status unavailable. " + evidenceReadError + " This is NOT a verified 'not run' result."}
            {evidenceReadPhase === "unavailable" && (
              <button type="button" className="secondary-button" onClick={() => void refreshEvidence().catch(() => undefined)}>Retry BIR evidence</button>
            )}
          </p>
        ) : (
          <p data-bir-v70-validation-status role="status" style={{ margin: 0 }}>
            Validated against BIR Alphalist Module v7.0: <strong>{evidence?.moduleV70.status}</strong>.
            {" "}For v7.4: <strong>{evidence?.moduleV74.status}</strong>.
          </p>
        )}
        <small>Only an independently reviewed, version-specific result for the latest matching file SHA-256 can show yes/no. The status is operator-recorded evidence, not BIR submission or acceptance.</small>
        {(evidence?.moduleV70.reportedAwaitingReview || evidence?.moduleV74.reportedAwaitingReview) && (
          <p role="status">At least one module observation is awaiting review by another authorized operator.</p>
        )}
        <details>
          <summary>Record external BIR module result (first operator)</summary>
          <div style={{ ...formStyle, paddingTop: 10 }}>
            <label style={labelStyle}>Module version
              <select value={version} onChange={event => setVersion(event.target.value as "7.0" | "7.4")}>
                <option value="7.0">v7.0 (historical)</option>
                <option value="7.4">v7.4</option>
              </select></label>
            <label style={labelStyle}>Exact DAT SHA-256 (from the downloaded file)
              <input aria-label="DAT file SHA-256" value={fileSha} maxLength={64} style={{ width: "100%", minWidth: 0 }}
                onChange={event => setFileSha(event.target.value)} placeholder="64 hexadecimal characters" />
            </label>
            <label style={labelStyle}>Official module result
              <select value={result} onChange={event => setResult(event.target.value as "pass" | "fail")}>
                <option value="pass">Passed validation</option>
                <option value="fail">Failed validation</option>
              </select></label>
            <label style={labelStyle}>Date validation was run
              <input type="date" aria-label="BIR module validation date" value={validatedOn}
                onChange={event => setValidatedOn(event.target.value)} />
            </label>
            <label style={labelStyle}>Private evidence reference (redacted screenshot/log kept outside GitHub)
              <input aria-label="Validator evidence reference" value={evidenceReference} maxLength={160}
                onChange={event => setEvidenceReference(event.target.value)} />
            </label>
            <button type="button" className="secondary-button" disabled={evidenceLoading || !legalEntityId || !sourceDigest || evidenceReadPhase !== "verified" || !evidence}
              onClick={() => void submitEvidence("observe")}>Record observation (not yet verified)</button>
          </div>
        </details>
        <details>
          <summary>Independently review existing observation (second operator)</summary>
          <div style={{ ...formStyle, paddingTop: 10 }}>
            <label style={labelStyle}>Observation ID from first operator
              <input type="number" min={1} aria-label="Observation ID" value={observationId}
                onChange={event => setObservationId(event.target.value)} />
            </label>
            <label style={labelStyle}>Review decision
              <select value={reviewDecision} onChange={event => setReviewDecision(event.target.value as "confirmed" | "rejected")}>
                <option value="confirmed">Confirm evidence matches exact DAT and official module result</option>
                <option value="rejected">Reject evidence</option>
              </select></label>
            <label style={labelStyle}>Private independent-review evidence reference
              <input aria-label="Independent review evidence reference" maxLength={160}
                value={reviewReference} onChange={event => setReviewReference(event.target.value)} />
            </label>
            <button type="button" className="secondary-button" disabled={evidenceLoading || !legalEntityId}
              onClick={() => void submitEvidence("review")}>Record independent review</button>
          </div>
        </details>
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { FileCheck2, UploadCloud } from "lucide-react";
import type { Notify } from "./types";
import { Spinner } from "./ui";
import { readVerifiedPaymentProof, type VerifiedPaymentProofRow } from "@/lib/statutory-payment-proof-read";

type EvidenceRow = VerifiedPaymentProofRow;

type PaymentProofProps = {
  organizationId: number;
  batchId: number;
  batchStatus: string;
  notify: Notify;
};

export function StatutoryPaymentProof(props: PaymentProofProps) {
  // File and replacement drafts belong to one employer's remittance batch.
  return <StatutoryPaymentProofContent key={`${props.organizationId}:${props.batchId}`} {...props} />;
}

function StatutoryPaymentProofContent({
  organizationId,
  batchId,
  batchStatus,
  notify,
}: PaymentProofProps) {
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [active, setActive] = useState<EvidenceRow | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [readPhase, setReadPhase] = useState<"loading" | "verified" | "unavailable">("loading");
  const [readError, setReadError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    // Evidence and upload eligibility are invalid during every new read.
    setReadPhase("loading");
    setReadError("");
    setRows([]);
    setActive(null);
    try {
      const verified = await readVerifiedPaymentProof(organizationId, batchId, fetch, signal);
      if (signal?.aborted) return;
      setRows(verified.evidence);
      setActive(verified.active);
      setReadPhase("verified");
    } catch (caught) {
      if (!signal?.aborted) {
        setRows([]);
        setActive(null);
        setReadPhase("unavailable");
        setReadError(caught instanceof Error ? caught.message : "Payment proof unavailable.");
      }
      throw caught;
    }
  }, [batchId, organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    // Schedule the initial read outside synchronous effect setup.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void load(controller.signal).catch((error) => {
        if (!controller.signal.aborted) {
          notify(error instanceof Error ? error.message : "Could not load payment proof.", "err");
        }
      });
    });
    return () => controller.abort();
  }, [load, notify]);

  async function upload() {
    if (busy || readPhase !== "verified") {
      notify("Payment proof is unavailable until the employer and batch evidence are verified. Retry.", "err");
      return;
    }
    if (!file) {
      notify("Choose a PDF, JPEG or PNG payment receipt first.", "err");
      return;
    }
    if (active && replacementReason.trim().length < 4) {
      notify("Explain why the active payment proof is being replaced.", "err");
      return;
    }
    if (!active && batchStatus !== "open" && replacementReason.trim().length < 8) {
      notify("Explain why historical payment proof is being backfilled.", "err");
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.set("organizationId", String(organizationId));
      form.set("batchId", String(batchId));
      form.set("file", file);
      if (replacementReason.trim()) form.set("replacementReason", replacementReason.trim());

      const response = await fetch("/api/compliance/statutory-remittances/payment-evidence", {
        method: "POST",
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Payment proof could not be uploaded.");
      await load();
      notify(active ? "Payment proof replaced with audit history preserved." : "Payment proof uploaded and hashed.", "ok");
      setFile(null);
      setReplacementReason("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Payment proof could not be uploaded.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }} data-statutory-payment-proof>
      {readPhase !== "verified" ? (
        <div className="notice notice-amber" role={readPhase === "unavailable" ? "alert" : "status"}>
          <span>{readPhase === "loading" ? "Verifying payment proof for this employer and batch…" : "Payment proof unavailable. " + readError + " No receipt recording is permitted."}</span>
          {readPhase === "unavailable" && <button type="button" className="secondary-button" onClick={() => void load().catch(() => undefined)}>Retry payment proof</button>}
        </div>
      ) : <>
      {active ? (
        <div className="notice notice-green" style={{ margin: 0 }}>
          <FileCheck2 size={15} />
          <span>
            <strong>Payment proof attached.</strong>{" "}
            {active.fileName} · {(active.byteSize / 1024).toFixed(1)} KB · SHA-256 {active.fileSha256.slice(0, 12)}…
            {" "}
            <a
              href={"/api/compliance/statutory-remittances/payment-evidence/" + active.id + "?organizationId=" + organizationId}
              target="_blank"
              rel="noreferrer"
            >
              Download
            </a>
          </span>
        </div>
      ) : (
        <div className="notice notice-amber" style={{ margin: 0 }}>
          <UploadCloud size={15} />
          <span><strong>Payment proof required.</strong> Attach the official agency/bank receipt before payment can be recorded.</span>
        </div>
      )}

      {(batchStatus === "open" || !active) && (
        <div className="setting-form">
          <label>
            Receipt / acknowledgement file
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {(active || batchStatus !== "open") && (
            <label>
              {active ? "Replacement reason" : "Historical backfill reason"}
              <input
                value={replacementReason}
                onChange={(event) => setReplacementReason(event.target.value)}
                placeholder={active
                  ? "Why the previous proof must be superseded"
                  : "Why this paid historical batch needs evidence backfilled"}
              />
            </label>
          )}
          <div style={{ alignSelf: "end" }}>
            <button className="secondary-button" disabled={busy || !file || readPhase !== "verified"} onClick={() => void upload()}>
              {busy ? <Spinner label="Uploading" /> : <UploadCloud size={14} />}
              {active ? "Replace proof" : batchStatus === "open" ? "Upload proof" : "Backfill proof"}
            </button>
          </div>
        </div>
      )}

      {rows.some((row) => row.status === "superseded") && (
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 12 }}>
            Superseded proof history ({rows.filter((row) => row.status === "superseded").length})
          </summary>
          <div className="policy-lines" style={{ marginTop: 8 }}>
            {rows.filter((row) => row.status === "superseded").map((row) => (
              <span key={row.id}>
                <b>{row.fileName}</b>
                <small style={{ display: "block", color: "var(--muted)" }}>
                  SHA-256 {row.fileSha256.slice(0, 12)}… · {row.replacementReason ?? "Superseded before payment"}
                </small>
              </span>
            ))}
          </div>
        </details>
      )}
      </>}
    </div>
  );
}

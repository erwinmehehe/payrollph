"use client";

import { useCallback, useState } from "react";
import { confirmsStoredPaymentProof, readVerifiedPaymentProof } from "@/lib/statutory-payment-proof-read";
import { useScopedAsyncResource } from "./use-scoped-async-resource";
import { FileCheck2, UploadCloud } from "lucide-react";
import type { Notify } from "./types";
import { Spinner } from "./ui";

// Optional explanatory state only: failed/mismatched evidence reads block
// upload unconditionally, regardless of this flag.
const complianceReadStateUiEnabled =
  process.env.NEXT_PUBLIC_COMPLIANCE_READ_STATE_UI_ENABLED === "true";

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
  const [file, setFile] = useState<File | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback((signal: AbortSignal) =>
    readVerifiedPaymentProof(organizationId, batchId, fetch, signal),
  [organizationId, batchId]);
  const { data: proof, loading, error, reload, isCurrent } = useScopedAsyncResource(
    "statutory-payment-proof:" + organizationId + ":" + batchId, load,
  );
  const rows = proof?.evidence ?? [];
  const active = proof?.active ?? null;

  async function upload() {
    if (!proof) {
      notify("Payment proof has not been verified. Retry the source read.", "err");
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
      if (body.organizationId !== organizationId || body.batchId !== batchId ||
          !Number.isSafeInteger(body.evidence?.id) || body.evidence.id <= 0 ||
          typeof body.evidence?.fileSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(body.evidence.fileSha256)) {
        throw new Error("Payment proof response could not be verified; refresh current evidence before retrying.");
      }
      setFile(null);
      setReplacementReason("");
      const refreshed = await reload();
      if (!isCurrent()) return; // A retired employer/batch must not emit a new result.
      if (!confirmsStoredPaymentProof(refreshed?.data ?? null, organizationId, batchId, body.evidence)) {
        notify("Payment proof may be stored, but the refreshed evidence was not verified. Retry payment proof to confirm before another upload.", "err");
        return;
      }
      notify("Payment proof stored and verified in refreshed evidence.", "ok");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Payment proof could not be uploaded.", "err");
    } finally {
      setBusy(false);
    }
  }

  if (!proof) return (
    <div data-statutory-payment-proof className="notice notice-amber" style={{ display: "grid", gap: 8 }}>
      <strong>{loading ? "Checking payment proof…" : "Payment proof unavailable"}</strong>
      {!loading && <span>{error?.message ?? "The evidence read could not be verified."}</span>}
      {!loading && complianceReadStateUiEnabled && (
        <span role="status" style={{ overflowWrap: "anywhere" }}>
          Payment evidence cannot be accepted as filed or uploaded until this employer and batch have a verified source read.
        </span>
      )}
      {!loading && <button className="secondary-button" type="button" onClick={() => void reload()}>Retry payment proof</button>}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 8 }} data-statutory-payment-proof>
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
            <button className="secondary-button" disabled={busy || !file} onClick={() => void upload()}>
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
    </div>
  );
}

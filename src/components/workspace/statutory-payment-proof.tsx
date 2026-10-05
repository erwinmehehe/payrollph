"use client";

import { useCallback, useEffect, useState } from "react";
import { FileCheck2, UploadCloud } from "lucide-react";
import type { Notify } from "./types";
import { Spinner } from "./ui";

type EvidenceRow = {
  id: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  fileSha256: string;
  status: string;
  replacementReason: string | null;
  uploadedByName: string;
  uploadedAt: string;
  supersededAt: string | null;
};

export function StatutoryPaymentProof({
  organizationId,
  batchId,
  batchStatus,
  notify,
  onActiveChange,
}: {
  organizationId: number;
  batchId: number;
  batchStatus: string;
  notify: Notify;
  onActiveChange: (active: EvidenceRow | null) => void;
}) {
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [active, setActive] = useState<EvidenceRow | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(
      "/api/compliance/statutory-remittances/payment-evidence?organizationId="
      + organizationId
      + "&batchId="
      + batchId,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load payment proof.");
    const nextRows = Array.isArray(body.evidence) ? body.evidence : [];
    const nextActive = body.active ?? null;
    setRows(nextRows);
    setActive(nextActive);
    onActiveChange(nextActive);
  }, [batchId, onActiveChange, organizationId]);

  useEffect(() => {
    void load().catch((error) => notify(
      error instanceof Error ? error.message : "Could not load payment proof.",
      "err",
    ));
  }, [load, notify]);

  async function upload() {
    if (!file) {
      notify("Choose a PDF, JPEG or PNG payment receipt first.", "err");
      return;
    }
    if (active && replacementReason.trim().length < 4) {
      notify("Explain why the active payment proof is being replaced.", "err");
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
      notify(active ? "Payment proof replaced with audit history preserved." : "Payment proof uploaded and hashed.", "ok");
      setFile(null);
      setReplacementReason("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Payment proof could not be uploaded.", "err");
    } finally {
      setBusy(false);
    }
  }

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

      {batchStatus === "open" && (
        <div className="setting-form">
          <label>
            Receipt / acknowledgement file
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {active && (
            <label>
              Replacement reason
              <input
                value={replacementReason}
                onChange={(event) => setReplacementReason(event.target.value)}
                placeholder="Why the previous proof must be superseded"
              />
            </label>
          )}
          <div style={{ alignSelf: "end" }}>
            <button className="secondary-button" disabled={busy || !file} onClick={() => void upload()}>
              {busy ? <Spinner label="Uploading" /> : <UploadCloud size={14} />}
              {active ? "Replace proof" : "Upload proof"}
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

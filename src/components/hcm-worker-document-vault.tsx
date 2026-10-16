"use client";

import { useEffect, useState } from "react";
import { Download, Eye, FileText, RefreshCw, ShieldCheck, Trash2, UploadCloud } from "lucide-react";

type VaultDocument = {
  id: number;
  employeeId: number | null;
  kind: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  scannedClean: boolean;
  uploadedBy: string;
  createdAt: string;
  canRemove: boolean;
};
type VaultPayload = {
  vaultEnabled: boolean;
  uploadEnabled: boolean;
  storageReady: boolean;
  documents: VaultDocument[];
  limits: { maxBytes: number; accepted: string[] };
};
type Load = {
  key: string;
  status: "ready" | "error" | "denied";
  data: VaultPayload | null;
  error: string;
};

const CATEGORY_OPTIONS = [
  { value: "government_id", label: "Government ID" },
  { value: "contract", label: "Contract" },
  { value: "certificate", label: "Certificate" },
  { value: "other", label: "Other paperwork" },
] as const;
const ACCEPTED_FILE = /\.(pdf|png|jpe?g)$/i;
const MAX_BYTES = 5 * 1024 * 1024;

function humanSize(n: number) {
  return (n / 1024 / 1024).toFixed(2) + " MB";
}
function uploadValidation(file: File): string | null {
  if (!file.size) return "Choose a nonempty file.";
  if (file.size > MAX_BYTES) return "Files must be 5 MB or smaller.";
  if (!ACCEPTED_FILE.test(file.name) ||
    !["application/pdf", "image/png", "image/jpeg", ""].includes(file.type)) {
    return "Only PDF, PNG and JPEG files are accepted.";
  }
  return null;
}

/**
 * Document actions belong to /api/documents, not Worker 360 payroll or
 * employment-history projections. React keys and scope checks protect
 * against stale employer/employee responses after switching context.
 */
export function WorkerDocumentVault({ organizationId, employeeId }: {
  organizationId: number; employeeId: number;
}) {
  const key = organizationId + ":" + employeeId;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<Load | null>(null);
  const [category, setCategory] = useState<string>("other");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const active = state?.key === key ? state : null;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      organizationId: String(organizationId),
      employeeId: String(employeeId),
    });
    void fetch("/api/documents?" + query.toString(), {
      cache: "no-store", signal: controller.signal,
    }).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (response.status === 403 || response.status === 404) {
        setState({ key, status: "denied", data: null,
          error: "Document access is restricted to the employee, HR and the organization owner." });
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to load private documents.");
      if (!Array.isArray(payload.documents) ||
        payload.documents.some((item: VaultDocument) => item.employeeId !== employeeId)) {
        throw new Error("Document employee scope did not match this profile.");
      }
      setState({ key, status: "ready", data: payload as VaultPayload, error: "" });
    }).catch(error => {
      if (controller.signal.aborted) return;
      setState({ key, status: "error", data: null,
        error: error instanceof Error ? error.message : "Documents could not be loaded." });
    });
    return () => controller.abort();
  }, [key, organizationId, employeeId, revision]);

  function refresh() { setRevision(value => value + 1); }
  async function upload() {
    if (!file || busy) return;
    const problem = uploadValidation(file);
    if (problem) { setNotice(problem); return; }
    setBusy(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("organizationId", String(organizationId));
      form.set("employeeId", String(employeeId));
      form.set("kind", category);
      form.set("file", file);
      const response = await fetch("/api/documents", { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Secure upload failed.");
      setFile(null);
      const input = document.getElementById("worker-vault-file-" + employeeId) as HTMLInputElement | null;
      if (input) input.value = "";
      setNotice("File uploaded and malware-checked. HR verification is separate.");
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Secure upload failed.");
    } finally { setBusy(false); }
  }

  async function remove(id: number) {
    if (busy || !window.confirm(
      "Remove this upload from the active vault? The stored file and audit record will be retained under the A-5 retention policy.",
    )) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/documents/" + id, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Could not remove document.");
      setNotice("Document removed from the active list. Retention and legal holds remain in force.");
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove document.");
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="worker360-document-vault" className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Private employee records</p>
          <h2 id="worker360-document-vault" className="mt-1 text-xl font-bold">Documents</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Contracts, IDs, certificates and onboarding paperwork. Separate from payroll calculations and government filing.
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={busy}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
      </div>

      {!active && <p role="status" className="mt-5 text-sm text-slate-600">Loading authorized document records…</p>}
      {active && active.status !== "ready" &&
        <p role="alert" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{active.error}</p>}

      {active?.data && !active.data.vaultEnabled &&
        <div role="status" className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          The private A-5 vault is disabled until its storage, malware scanning and privacy approvals are completed. No legacy database-base64 upload is offered here.
        </div>}

      {active?.data?.vaultEnabled && (
        <>
          {notice && <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">{notice}</p>}
          <div className="mt-5 grid gap-3">
            {active.data.documents.length === 0
              ? <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">No active employee documents in this vault.</p>
              : active.data.documents.map(item => (
                <article key={item.id} className="min-w-0 rounded-xl border border-slate-200 p-4">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <FileText className="mt-1 shrink-0 text-emerald-800" size={18} aria-hidden="true" />
                      <div className="min-w-0">
                        <h3 className="break-all text-sm font-bold text-slate-900">{item.fileName}</h3>
                        <p className="mt-1 text-xs text-slate-600">
                          {item.kind.replaceAll("_", " ")} · {humanSize(item.byteSize)} · uploaded by {item.uploadedBy}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(item.createdAt))}
                          {item.scannedClean ? " · Scan passed" : " · Pending verification"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.scannedClean && <>
                        <a className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-50"
                          href={"/api/documents/" + item.id} target="_blank" rel="noopener noreferrer">
                          <Eye size={14} aria-hidden="true" /> View
                        </a>
                        <a className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-50"
                          href={"/api/documents/" + item.id + "?download=1"} rel="noreferrer">
                          <Download size={14} aria-hidden="true" /> Download
                        </a>
                      </>}
                      {item.canRemove &&
                        <button type="button" onClick={() => void remove(item.id)} disabled={busy}
                          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50">
                          <Trash2 size={14} aria-hidden="true" /> Delete
                        </button>}
                    </div>
                  </div>
                </article>
              ))}
          </div>
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold"><UploadCloud size={17} aria-hidden="true" /> Upload employee document</h3>
            <p className="mt-1 text-xs text-slate-600">PDF, PNG or JPEG only · maximum 5 MB. Server-side type detection and malware scanning are required.</p>
            {!active.data.storageReady || !active.data.uploadEnabled
              ? <p role="status" className="mt-3 text-sm font-semibold text-amber-900">
                  Uploads are blocked until approved private object storage and malware scanning are configured and enabled.
                </p>
              : <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-semibold">Category
                    <select value={category} onChange={event => setCategory(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm">
                      {CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="block min-w-0 text-sm font-semibold">File
                    <input id={"worker-vault-file-" + employeeId} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                      onChange={event => {
                        const next = event.target.files?.[0] ?? null;
                        setNotice(next ? uploadValidation(next) ?? "" : "");
                        setFile(next && !uploadValidation(next) ? next : null);
                      }} className="mt-1 block w-full max-w-full rounded-lg border border-slate-300 bg-white p-2 text-xs" />
                  </label>
                  <button type="button" onClick={() => void upload()} disabled={!file || busy}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50">
                    <UploadCloud size={16} aria-hidden="true" /> {busy ? "Working…" : "Upload securely"}
                  </button>
                </div>}
          </div>
          <p className="mt-4 flex items-start gap-2 text-xs text-slate-600">
            <ShieldCheck size={16} aria-hidden="true" className="shrink-0" />
            Only authorized HR/owner access is supported here; manager access is OFF until a verified delegation policy exists.
            Deletion hides an unlinked upload while preserving stored bytes and audit history for legal retention.
          </p>
        </>
      )}
    </section>
  );
}

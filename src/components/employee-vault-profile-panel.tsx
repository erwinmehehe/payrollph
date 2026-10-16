"use client";

import { useEffect, useState } from "react";
import { Download, Eye, FileText, RefreshCw, ShieldCheck, Trash2, UploadCloud } from "lucide-react";

type VaultFile = {
  id: number; fileName: string; kind: string; byteSize: number;
  uploadedAt: string; uploadedBy: string; canRemove: boolean;
};
type VaultPayload = { organizationId: number; employeeId: number; documents: VaultFile[] };
const choices = [
  { id: "government_id", name: "Government ID" },
  { id: "contract", name: "Contract" },
  { id: "certificate", name: "Certificate" },
  { id: "onboarding", name: "Onboarding paperwork" },
  { id: "other", name: "Other" },
];
const LIMIT = 5 * 1024 * 1024;

function dateText(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" }).format(date)
    : "Date unavailable";
}
function sizeText(bytes: number) {
  return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + " MB" :
    Math.max(1, Math.ceil(bytes / 1024)) + " KB";
}

/** Files and signing credentials never enter this component. */
export function EmployeeVaultProfilePanel({ organizationId, employeeId, uploadsEnabled }: {
  organizationId: number; employeeId: number; uploadsEnabled: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<VaultPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState("other");
  const [file, setFile] = useState<File | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      organizationId: String(organizationId), employeeId: String(employeeId),
    });
    void fetch("/api/employee-vault?" + query, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Unauthorized vault request.");
        const next = await response.json() as VaultPayload;
        if (controller.signal.aborted) return;
        if (next.organizationId !== organizationId || next.employeeId !== employeeId ||
            !Array.isArray(next.documents)) throw new Error("Vault employee context changed.");
        setData(next);
        setError("");
      }).catch(() => {
        if (!controller.signal.aborted) {
          setData(null);
          setError("Unable to load authorized employee documents.");
        }
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [organizationId, employeeId, revision]);

  function refresh() { setLoading(true); setRevision(n => n + 1); }

  async function upload() {
    if (!file || busy || !uploadsEnabled) return;
    if (file.size <= 0 || file.size > LIMIT ||
        !/\.(pdf|png|jpe?g)$/i.test(file.name) ||
        (file.type !== "" && !["application/pdf", "image/png", "image/jpeg"].includes(file.type))) {
      setError("Choose a PDF, PNG or JPEG file no larger than 5 MB.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("organizationId", String(organizationId));
      form.set("employeeId", String(employeeId));
      form.set("kind", category);
      form.set("file", file);
      const response = await fetch("/api/documents", { method: "POST", body: form });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Private upload failed.");
      setFile(null);
      setNotice("Document scanned and stored in the private employee vault.");
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (busy || confirmId !== id) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/employee-vault/" + id, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? "Removal refused.");
      }
      setConfirmId(null);
      setNotice("Removed from the active vault. Retention and legal holds still apply.");
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Removal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="worker360-documents" className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-800">
            <ShieldCheck size={16} aria-hidden="true" /> Private HR 201-file
          </p>
          <h2 id="worker360-documents" className="mt-2 text-xl font-bold">Employee documents</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Contracts, government IDs, certificates and onboarding paperwork.
            Files do not change payroll calculations, statutory contributions, tax or payouts.
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}

      {uploadsEnabled ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-semibold">Upload a document</h3>
          <p className="mt-1 text-xs text-slate-600">PDF, PNG or JPEG · 5 MB maximum · malware-scanned before private storage</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
            <label className="block text-sm font-medium">Category
              <select value={category} onChange={e => setCategory(e.target.value)} disabled={busy}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
                {choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block min-w-0 text-sm font-medium">File
              <input key={revision} type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={busy}
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm" />
            </label>
            <button type="button" onClick={() => void upload()} disabled={!file || busy}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-40">
              <UploadCloud size={16} aria-hidden="true" /> {busy ? "Working…" : "Upload"}
            </button>
          </div>
        </div>
      ) : <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Uploads are disabled until the A-5 private object-storage rollout is approved.
      </p>}

      <h3 className="mt-6 font-semibold">Stored files {data ? "(" + data.documents.length + ")" : ""}</h3>
      {loading && <p role="status" className="mt-3 text-sm text-slate-600">Loading authorized files…</p>}
      {!loading && data?.documents.length === 0 && <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No active employee documents.</p>}
      {!loading && data && (
        <ul aria-label="Employee documents" className="mt-3 space-y-3">
          {data.documents.map(item => (
            <li key={item.id} className="min-w-0 rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <FileText size={20} aria-hidden="true" className="mt-1 shrink-0 text-emerald-800" />
                  <div className="min-w-0">
                    <p className="break-all font-semibold">{item.fileName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {choices.find(c => c.id === item.kind)?.name ?? item.kind} · {sizeText(item.byteSize)} ·
                      {dateText(item.uploadedAt)} · Uploaded by {item.uploadedBy}
                    </p>
                  </div>
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <a href={"/api/documents/" + item.id} target="_blank" rel="noreferrer"
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg border px-3 text-sm font-semibold sm:flex-none">
                    <Eye size={15} aria-hidden="true" /> View
                  </a>
                  <a href={"/api/documents/" + item.id + "?download=1"}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg border px-3 text-sm font-semibold sm:flex-none">
                    <Download size={15} aria-hidden="true" /> Download
                  </a>
                  {item.canRemove && (confirmId === item.id ? (
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                      <span className="text-xs text-amber-950">Remove active file?</span>
                      <button type="button" disabled={busy} onClick={() => void remove(item.id)}
                        className="min-h-11 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white">Confirm</button>
                      <button type="button" disabled={busy} onClick={() => setConfirmId(null)}
                        className="min-h-11 rounded-lg border px-3 text-sm">Cancel</button>
                    </div>
                  ) : <button type="button" disabled={busy} onClick={() => setConfirmId(item.id)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-800">
                    <Trash2 size={15} aria-hidden="true" /> Delete
                  </button>)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-5 text-xs text-slate-500">
        Delete removes only unlinked uploads from active access. Object bytes and audit evidence
        are retained until separately approved A-5 retention, legal-hold and erasure workflows.
      </p>
    </section>
  );
}

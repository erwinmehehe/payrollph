"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listOfflinePunches, queueOfflinePunch, removeOfflinePunch,
  type OfflinePunchIntent,
} from "@/lib/workforce-offline-punch-client";

type PunchAction = "clock_in" | "clock_out" | "break_start" | "break_end";
type PhotoPolicy = {
  captureEnabled: boolean;
  consent: boolean | null;
  worksiteId: number | null;
  purpose: string;
  retentionDays: number;
};

export function WorkforcePunchEvidencePanel(input: {
  organizationId: number;
  employeeId: number;
  onPhotoPrepared: (image: { id: string; actionType: "clock_in" | "clock_out" } | null) => void;
}) {
  const { organizationId, employeeId, onPhotoPrepared } = input;
  const [photoPolicy, setPhotoPolicy] = useState<PhotoPolicy | null>(null);
  const [offlineEnabled, setOfflineEnabled] = useState(false);
  const [pending, setPending] = useState<OfflinePunchIntent[]>([]);
  const [action, setAction] = useState<PunchAction>("clock_in");
  const [uploadAction, setUploadAction] = useState<"clock_in" | "clock_out">("clock_in");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inProgress = useRef(false);
  const updatePending = useCallback(async () => {
    const queued = await listOfflinePunches(organizationId, employeeId);
    setPending(queued);
  }, [organizationId, employeeId]);
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([
      fetch(`/api/workforce/punch-evidence?organizationId=${organizationId}`, {
        signal: abort.signal, cache: "no-store",
      }).then(async r => {
        if (!r.ok) return;
        const policy = await r.json() as PhotoPolicy;
        if (!abort.signal.aborted) setPhotoPolicy(policy);
      }),
      fetch(`/api/workforce/offline-punches?organizationId=${organizationId}`, {
        signal: abort.signal, cache: "no-store",
      }).then(async r => {
        if (!r.ok) return;
        const body = await r.json() as {canQueueSelf?:boolean};
        if (!abort.signal.aborted && body.canQueueSelf === true) setOfflineEnabled(true);
      }),
      updatePending(),
    ]).catch(() => { /* Offline capability is loaded only from a prior authorized view. */ });
    return () => abort.abort();
  }, [organizationId, employeeId, updatePending, onPhotoPrepared]);

  const sync = useCallback(async () => {
    if (!offlineEnabled || inProgress.current || !navigator.onLine) return;
    inProgress.current = true;
    try {
      const rows = await listOfflinePunches(organizationId, employeeId);
      for (const entry of rows) {
        const r = await fetch("/api/workforce/offline-punches", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", ...entry }),
        });
        if (r.status !== 202) break;
        await removeOfflinePunch(entry.id);
      }
      await updatePending();
    } catch { /* An uncertain sync is not a recorded punch; retained for retry. */ }
    finally { inProgress.current = false; }
  }, [employeeId, offlineEnabled, organizationId, updatePending]);

  useEffect(() => {
    if (!offlineEnabled) return;
    // Trigger sync from the queue action or a network-online event.
    const listener = () => { void sync(); };
    window.addEventListener("online", listener);
    return () => window.removeEventListener("online", listener);
  }, [offlineEnabled, sync]);

  async function choice(consented: boolean) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/workforce/punch-evidence", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action: "consent", consented }),
      });
      if (!r.ok) throw Error("Could not record your photo evidence preference.");
      setPhotoPolicy(current => current ? { ...current, consent: consented } : null);
      setMessage(consented ? "Optional selfie consent recorded." :
        "Selfie declined. Attendance cannot be rejected automatically for this choice.");
      if (!consented) onPhotoPrepared(null);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function upload(file: File | null) {
    if (!file || !photoPolicy?.captureEnabled || photoPolicy.consent !== true) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.set("organizationId", String(organizationId));
      form.set("actionType", uploadAction);
      form.set("photo", file, file.name);
      const response = await fetch("/api/workforce/punch-evidence", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.photoEvidenceId !== "string") {
        throw Error(typeof data.error === "string" ? data.error : "Image evidence was not saved.");
      }
      onPhotoPrepared({ id: data.photoEvidenceId, actionType: uploadAction });
      setMessage("Encrypted photo prepared for human review; now record the chosen clock action.");
    } catch (reason) {
      onPhotoPrepared(null);
      setError(reason instanceof Error ? reason.message : "Photo unavailable.");
    } finally { setBusy(false); }
  }

  async function queue() {
    if (!offlineEnabled) return;
    setBusy(true); setError("");
    try {
      await queueOfflinePunch({
        organizationId, employeeId, actionType: action,
        worksiteId: photoPolicy?.worksiteId ?? null,
      });
      await updatePending();
      setMessage("Saved offline for HR review, NOT recorded as attendance or payroll.");
      if (navigator.onLine) void sync();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Offline evidence unavailable."); }
    finally { setBusy(false); }
  }
  if (!photoPolicy && !offlineEnabled) return null;
  return <section className="mt-4 space-y-3 rounded-xl border p-3" aria-label="Optional attendance evidence">
    <h3 className="font-semibold">Optional attendance evidence</h3>
    {photoPolicy?.captureEnabled && photoPolicy.consent === null && <div className="space-y-2">
      <p>{photoPolicy.purpose}</p>
      <p>Retention: {photoPolicy.retentionDays} days unless a reviewed legal hold applies.</p>
      <div className="flex gap-2">
        <button className="secondary-button" disabled={busy} onClick={() => void choice(true)}>I consent</button>
        <button className="secondary-button" disabled={busy} onClick={() => void choice(false)}>Decline selfie</button>
      </div>
    </div>}
    {photoPolicy?.captureEnabled && photoPolicy.consent === true && <div className="space-y-2">
      <p>Optional image evidence for a human reviewer only. No automated face matching or payroll decision.</p>
      <label>Attach to action
        <select value={uploadAction} disabled={busy} onChange={event =>
          setUploadAction(event.target.value as "clock_in" | "clock_out")}>
          <option value="clock_in">Clock IN</option><option value="clock_out">Clock OUT</option>
        </select>
      </label>
      <label>Selfie (JPEG/PNG, up to 512 KB)
        <input type="file" capture="user" accept="image/jpeg,image/png" disabled={busy}
          onChange={event => void upload(event.target.files?.[0] ?? null)}/>
      </label>
      <button className="secondary-button" disabled={busy} onClick={() => void choice(false)}>Withdraw selfie consent</button>
    </div>}
    {offlineEnabled && <div className="space-y-2">
      <p>When offline, queue an intent for human review. Queuing is not a successful clock punch, paid time, or automatic absence.</p>
      <div className="flex gap-2">
        <select value={action} disabled={busy} aria-label="Offline action"
          onChange={event => setAction(event.target.value as PunchAction)}>
          <option value="clock_in">Clock IN</option><option value="break_start">Break start</option>
          <option value="break_end">Break end</option><option value="clock_out">Clock OUT</option>
        </select>
        <button className="secondary-button" disabled={busy} onClick={() => void queue()}>
          Queue for HR review
        </button>
        <button className="secondary-button" disabled={busy || pending.length === 0}
          onClick={() => void sync()}>Sync pending</button>
      </div>
      <p role="status">{pending.length} local offline intent(s) awaiting sync or review confirmation.</p>
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

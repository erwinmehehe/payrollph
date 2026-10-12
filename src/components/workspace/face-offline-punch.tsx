"use client";

import { useEffect, useRef, useState } from "react";

type OfflineItem = { clientEventId: string; actionType: "clock_in" | "clock_out"; claimedAt: string };

function readQueue(key: string): OfflineItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is OfflineItem => row && typeof row === "object" &&
      typeof row.clientEventId === "string" && /^[\da-f-]{36}$/i.test(row.clientEventId) &&
      ["clock_in","clock_out"].includes(row.actionType) &&
      typeof row.claimedAt === "string" &&
      Number.isFinite(Date.parse(row.claimedAt)) &&
      Date.parse(row.claimedAt) > Date.now() - 7*86400_000).slice(0,10);
  } catch { return []; }
}
function saveQueue(key: string, rows: OfflineItem[]) {
  try { localStorage.setItem(key, JSON.stringify(rows)); return true; }
  catch { return false; }
}

/** No face matching, photo capture, biometric storage or automatic payroll punching. */
export function FaceOfflinePunchPanel({ organizationId, employeeId }: {
  organizationId: number; employeeId: number;
}) {
  const key = "linaw-unverified-offline-claims-v1:" + organizationId + ":" + employeeId;
  const [consent, setConsent] = useState(false);
  const [camera, setCamera] = useState<"idle"|"requesting"|"ready"|"error">("idle");
  const [cameraError, setCameraError] = useState("");
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState<OfflineItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    setOnline(navigator.onLine);
    setQueued(readQueue(key));
    const change = () => setOnline(navigator.onLine);
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, [key]);

  useEffect(() => {
    if (camera !== "ready" || !streamRef.current || !video.current) return;
    video.current.srcObject = streamRef.current;
  }, [camera]);

  async function openCamera() {
    if (!consent) return;
    setCamera("requesting"); setCameraError(""); setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("This browser does not support camera capture. Ask HR for an attendance exception.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user" } });
      if (!mountedRef.current) {
        media.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = media;
      setCamera("ready");
    } catch (cause) {
      setCamera("error");
      setCameraError(cause instanceof Error ? cause.message : "Camera unavailable.");
    }
  }
  function closeCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera("idle");
  }

  function queue(actionType: OfflineItem["actionType"]) {
    setError(""); setNotice("");
    if (!consent || online) return;
    if (queued.length >= 10) { setError("Offline claim limit reached. Ask HR for attendance review."); return; }
    const item: OfflineItem = { clientEventId: crypto.randomUUID(), actionType, claimedAt: new Date().toISOString() };
    const next = [...queued, item];
    setQueued(next);
    const persisted = saveQueue(key, next);
    setNotice(persisted
      ? "Queued offline on this device. Not clocked in/out or verified. Send the claim for HR review when connected."
      : "Queued only in this open tab; browser storage is unavailable. Keep the tab open until reconnected.");
  }

  async function submitQueue() {
    if (!online || !consent || saving || !queued.length) return;
    setSaving(true); setError(""); setNotice("");
    let remainder = [...queued];
    try {
      for (const item of queued) {
        const response = await fetch("/api/attendance/offline-claims", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId, employeeId,
            clientEventId: item.clientEventId, actionType: item.actionType,
            claimedAt: item.claimedAt, acknowledged: true }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Attendance claim was not received.");
        remainder = remainder.filter(row => row.clientEventId !== item.clientEventId);
        setQueued(remainder); saveQueue(key, remainder);
      }
      setNotice("Submitted for independent HR review. These claims have NOT changed attendance records or payroll.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Claim could not be sent. Check server history before trying again.");
      setQueued(remainder); saveQueue(key, remainder);
    } finally { setSaving(false); }
  }
  return <section className="card" style={{ marginTop: 14, padding: 14 }} aria-label="Consent and offline attendance claim">
    <div className="card-kicker">OPTIONAL ATTENDANCE SUPPORT</div>
    <h3>Camera preview and offline attendance claims</h3>
    <p>This camera step is a preview only: no image is uploaded, stored or matched against an identity.
      It is <strong>not face verification</strong>. Official clock-in/out still requires the live server time clock.</p>
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <input type="checkbox" checked={consent} onChange={e => {
        setConsent(e.target.checked); if (!e.target.checked) closeCamera();
      }}/>
      <span>I consent to an on-device camera preview and understand that offline claims
        are unverified evidence requiring independent HR review.</span>
    </label>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
      <button type="button" className="secondary-button" disabled={!consent || camera==="requesting"}
        onClick={() => void openCamera()}>{camera==="requesting" ? "Requesting camera…" : "Open camera preview"}</button>
      {camera==="ready" && <button type="button" className="secondary-button" onClick={closeCamera}>Stop camera</button>}
    </div>
    {camera==="ready" && <div>
      <video ref={video} autoPlay muted playsInline aria-label="Live camera preview, not face verification"
        style={{ width:"min(100%,330px)", borderRadius:10, background:"#0f172a" }}/>
      <p role="status">Camera preview ready. No photos recorded and identity has not been verified.</p>
    </div>}
    {camera==="error" && <p role="alert">{cameraError} You may continue without camera and request manual HR review.</p>}
    {!online && <div role="status" className="notice notice-amber">
      Offline: live punches cannot be verified. You may queue an attendance claim for later HR review.
    </div>}
    <div style={{ display: "flex", gap:8, flexWrap:"wrap", margin:"10px 0" }}>
      {!online && <>
        <button type="button" className="secondary-button" disabled={!consent} onClick={()=>queue("clock_in")}>
          Queue claimed clock-in
        </button>
        <button type="button" className="secondary-button" disabled={!consent} onClick={()=>queue("clock_out")}>
          Queue claimed clock-out
        </button>
      </>}
      {online && queued.length > 0 && <button type="button" className="primary-button"
        disabled={!consent || saving} onClick={()=>void submitQueue()}>
        {saving ? "Sending claims…" : "Send queued claims for HR review"}
      </button>}
    </div>
    {queued.length > 0 && <div className="notice notice-amber" role="status">
      <strong>{queued.length} queued offline</strong> — not verified, not recorded as a punch, and not used for payroll.
      <ul>{queued.map(item => <li key={item.clientEventId}>
        {item.actionType.replace("_"," ")} at device-reported {new Date(item.claimedAt).toLocaleString("en-PH")}
      </li>)}</ul>
    </div>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

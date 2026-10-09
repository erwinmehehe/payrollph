"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import {
  Camera, CheckCircle2, FileCheck2, Fingerprint, KeyRound,
  LockKeyhole, RefreshCcw, ShieldCheck, Trash2, UploadCloud,
} from "lucide-react";
import {
  ESS_IDENTIFIER_FIELDS, ESS_IDENTIFIER_KINDS,
  normalizeEssIdentifier, type EssIdentifierKind,
} from "@/lib/ess-identifiers";
import { passwordIssues } from "@/lib/validation";

type EmployeeDetails = {
  firstName: string;
  lastName: string;
  employeeNo: string;
  middleName?: string | null;
  birthDate?: string | null;
  nationality?: string | null;
  education?: string | null;
  dependentsCount?: number | null;
  region: string;
};
type IdData = {
  current: Record<EssIdentifierKind, { hasValue: boolean; masked: string | null }>;
  requests: Array<{
    id: number;
    kind: EssIdentifierKind;
    proposedMasked: string | null;
    status: string;
    requestedAt: string;
    reviewedAt: string | null;
    reviewNote: string | null;
  }>;
};

async function parseResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body.problems as string[] | undefined)?.join(" ") || body.error || "Something went wrong.");
  return body;
}

async function makeSmallPhoto(file: File): Promise<File> {
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose a photo smaller than 12 MB.");
  if (!file.type.startsWith("image/")) throw new Error("Choose a JPEG or PNG image.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image could not be opened. Try a JPEG or PNG photo.");
  }
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height) throw new Error("This photo is empty.");
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Photo processing is unavailable on this device.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 512, 512);
    const square = Math.min(width, height);
    ctx.drawImage(bitmap, (width - square) / 2, (height - square) / 2, square, square, 0, 0, 512, 512);
    for (const quality of [0.82, 0.7, 0.56]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size > 0 && blob.size <= 512 * 1024) {
        return new File([blob], "profile.jpg", { type: "image/jpeg" });
      }
    }
    throw new Error("Could not reduce this photo under 512 KB. Try a different image.");
  } finally {
    bitmap.close();
  }
}

export function EmployeeProfileExtras({
  employee, photoAvailable, photoVersion, onPhotoChanged,
}: {
  employee: EmployeeDetails;
  photoAvailable: boolean;
  photoVersion: number;
  onPhotoChanged: (available: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoNotice, setPhotoNotice] = useState("");
  const [ids, setIds] = useState<IdData | null>(null);
  const [idError, setIdError] = useState("");
  const [idNotice, setIdNotice] = useState("");
  const [idBusy, setIdBusy] = useState(false);
  const [idKind, setIdKind] = useState<EssIdentifierKind | null>(null);
  const [idValue, setIdValue] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");

  const loadIds = useCallback(async () => {
    const response = await fetch("/api/self/identifiers", { cache: "no-store" });
    return parseResponse(response) as Promise<IdData>;
  }, []);
  useEffect(() => {
    let active = true;
    void loadIds().then((data) => {
      if (active) { setIds(data); setIdError(""); }
    }).catch((error: unknown) => {
      if (active) setIdError(error instanceof Error ? error.message : "Could not load your identifiers.");
    });
    return () => { active = false; };
  }, [loadIds]);

  async function uploadPhoto(file: File | null) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError("");
    setPhotoNotice("");
    try {
      const converted = await makeSmallPhoto(file);
      const form = new FormData();
      form.append("photo", converted);
      await parseResponse(await fetch("/api/self/photo", { method: "POST", body: form }));
      onPhotoChanged(true);
      setPhotoNotice("Profile picture updated.");
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not upload your photo.");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function removePhoto() {
    setPhotoBusy(true);
    setPhotoError("");
    setPhotoNotice("");
    try {
      await parseResponse(await fetch("/api/self/photo", { method: "DELETE" }));
      onPhotoChanged(false);
      setPhotoNotice("Profile picture removed.");
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not remove your photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submitId(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!idKind) return;
    const normalized = normalizeEssIdentifier(idKind, idValue);
    if (!normalized.ok) { setIdError(normalized.error); return; }
    setIdError("");
    setIdNotice("");
    setIdBusy(true);
    try {
      await parseResponse(await fetch("/api/self/identifiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: idKind, value: normalized.value }),
      }));
      setIdValue("");
      setIdKind(null);
      setIds(await loadIds());
      setIdNotice("ID submitted securely. HR must verify it before your official records change.");
    } catch (error) {
      setIdError(error instanceof Error ? error.message : "Could not submit ID request.");
    } finally {
      setIdBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordNotice("");
    const issues = passwordIssues(nextPassword);
    if (issues.length || nextPassword !== confirmPassword) {
      setPasswordError([...issues, ...(nextPassword !== confirmPassword ? ["New passwords do not match."] : [])].join(" "));
      return;
    }
    setPasswordBusy(true);
    try {
      const body = await parseResponse(await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword: nextPassword, confirmPassword }),
      }));
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setPasswordNotice(body.note || "Password changed. Other signed-in devices have been logged out.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Could not change password.");
    } finally {
      setPasswordBusy(false);
    }
  }

  const pending = new Set(ids?.requests.filter((row) => row.status === "pending").map((row) => row.kind) ?? []);
  return (
    <div className="ess-profile-extensions">
      <section className="employee-edit-card ess-profile-card" aria-labelledby="ess-photo-heading">
        <div className="ess-profile-card-heading">
          <div>
            <h3 id="ess-photo-heading"><Camera size={20} aria-hidden="true" /> Profile picture</h3>
            <p>Choose a clear photo. Images are resized on your device and checked before saving.</p>
          </div>
        </div>
        <div className="ess-photo-layout">
          <div className="ess-profile-picture" aria-label="Current profile picture">
            {photoAvailable ? (
              <Image src={`/api/self/photo?v=${photoVersion}`} unoptimized width={88} height={88} alt={`Profile photo of ${employee.firstName} ${employee.lastName}`} />
            ) : (
              <span>{employee.firstName.charAt(0)}{employee.lastName.charAt(0)}</span>
            )}
          </div>
          <div className="ess-photo-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              aria-label="Select profile picture"
              onChange={(event) => void uploadPhoto(event.target.files?.[0] ?? null)}
              hidden
            />
            <button type="button" className="primary-button brand" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              <UploadCloud size={17} /> {photoBusy ? "Processing…" : photoAvailable ? "Change picture" : "Upload picture"}
            </button>
            {photoAvailable && (
              <button type="button" className="secondary-button" disabled={photoBusy} onClick={() => void removePhoto()}>
                <Trash2 size={16} /> Remove
              </button>
            )}
            <small>Square crop · JPEG / PNG · up to 512 KB after resizing</small>
          </div>
        </div>
        {photoNotice && <p className="ess-message good" role="status">{photoNotice}</p>}
        {photoError && <p className="ess-message error" role="alert">{photoError}</p>}
      </section>

      <section className="employee-edit-card ess-profile-card" aria-labelledby="ess-id-heading">
        <div className="ess-profile-card-heading">
          <div>
            <h3 id="ess-id-heading"><Fingerprint size={20} aria-hidden="true" /> Government IDs & credentials</h3>
            <p>Numbers are masked. Submit changes securely; HR verifies them before they affect official records or payroll.</p>
          </div>
          <span className="employee-status-pill neutral"><LockKeyhole size={13} /> Protected</span>
        </div>
        {idError && <p className="ess-message error" role="alert">{idError}</p>}
        {idNotice && <p className="ess-message good" role="status">{idNotice}</p>}
        {!ids && !idError && <p className="clean-muted">Loading your registered identifiers…</p>}
        <div className="ess-id-grid">
          {ESS_IDENTIFIER_KINDS.map((kind) => {
            const setting = ESS_IDENTIFIER_FIELDS[kind];
            const value = ids?.current[kind];
            const isPending = pending.has(kind);
            return (
              <div key={kind} className="ess-id-tile">
                <span>{setting.label}</span>
                <strong>{value?.masked ?? "Not on file"}</strong>
                {isPending ? (
                  <small className="ess-pending"><RefreshCcw size={13} /> Awaiting HR review</small>
                ) : (
                  <button type="button" className="ess-id-edit" disabled={!ids || idBusy} onClick={() => { setIdKind(kind); setIdValue(""); setIdError(""); setIdNotice(""); }}>
                    {value?.hasValue ? "Request correction" : "Add ID number"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {idKind && !pending.has(idKind) && (
          <form className="ess-id-form" onSubmit={(event) => void submitId(event)}>
            <label htmlFor="ess-id-value">{ESS_IDENTIFIER_FIELDS[idKind].label}
              <input
                id="ess-id-value"
                value={idValue}
                onChange={(event) => setIdValue(event.target.value)}
                inputMode={ESS_IDENTIFIER_FIELDS[idKind].inputMode}
                autoComplete="off"
                maxLength={40}
                placeholder={ESS_IDENTIFIER_FIELDS[idKind].hint}
                required
              />
            </label>
            <p>Enter the number from your official record. The saved value stays encrypted and is not immediately applied to payroll.</p>
            <div className="ess-inline-actions">
              <button type="button" className="secondary-button" disabled={idBusy} onClick={() => { setIdKind(null); setIdValue(""); }}>Cancel</button>
              <button type="submit" className="primary-button brand" disabled={idBusy || !idValue.trim()}>
                <ShieldCheck size={17} /> {idBusy ? "Submitting…" : "Send to HR for verification"}
              </button>
            </div>
          </form>
        )}
        {(ids?.requests.length ?? 0) > 0 && (
          <details className="ess-requests-history">
            <summary>Recent ID requests ({ids?.requests.length ?? 0})</summary>
            {ids?.requests.slice(0, 12).map((request) => (
              <div key={request.id} className="ess-request-row">
                <div>
                  <strong>{ESS_IDENTIFIER_FIELDS[request.kind].label}</strong>
                  <small>{request.proposedMasked || "••••"} · {new Date(request.requestedAt).toLocaleDateString("en-PH")}</small>
                </div>
                <span className={"employee-status-pill " + (request.status === "approved" ? "good" : request.status === "rejected" ? "bad" : "warn")}>
                  {request.status === "pending" ? "HR review" : request.status === "approved" ? "Verified" : "Needs correction"}
                </span>
                {request.status === "rejected" && request.reviewNote && <p>{request.reviewNote}</p>}
              </div>
            ))}
          </details>
        )}
        <p className="ess-privacy-note"><FileCheck2 size={16} aria-hidden="true" /> Never enter a PhilSys Number (PSN) or upload identity documents in this field. Use the official Documents section for files requested by HR.</p>
      </section>

      <section className="employee-edit-card ess-profile-card" aria-labelledby="ess-employment-heading">
        <div className="ess-profile-card-heading">
          <div>
            <h3 id="ess-employment-heading"><FileCheck2 size={20} aria-hidden="true" /> Additional personal details</h3>
            <p>These HR records are shown for your reference. Contact HR if anything is inaccurate.</p>
          </div>
        </div>
        <dl className="ess-details-grid">
          <div><dt>Middle name</dt><dd>{employee.middleName || "Not recorded"}</dd></div>
          <div><dt>Date of birth</dt><dd>{employee.birthDate || "Not recorded"}</dd></div>
          <div><dt>Nationality</dt><dd>{employee.nationality || "Not recorded"}</dd></div>
          <div><dt>Region</dt><dd>{employee.region || "Not recorded"}</dd></div>
          <div><dt>Dependents</dt><dd>{employee.dependentsCount ?? "Not recorded"}</dd></div>
          <div><dt>Education</dt><dd>{employee.education || "Not recorded"}</dd></div>
        </dl>
      </section>

      <section className="employee-edit-card ess-profile-card" aria-labelledby="ess-password-heading">
        <div className="ess-profile-card-heading">
          <div>
            <h3 id="ess-password-heading"><KeyRound size={20} aria-hidden="true" /> Change password</h3>
            <p>You'll need your current password. After updating, your other sessions will be signed out.</p>
          </div>
        </div>
        <form onSubmit={(event) => void changePassword(event)} className="ess-password-form">
          <label htmlFor="ess-current-password">Current password
            <input id="ess-current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          <label htmlFor="ess-new-password">New password
            <input id="ess-new-password" type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} required />
          </label>
          <label htmlFor="ess-confirm-password">Confirm new password
            <input id="ess-confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} required />
          </label>
          <p className="ess-password-help">Use 12+ characters with uppercase and lowercase letters and a number.</p>
          {passwordError && <p className="ess-message error" role="alert">{passwordError}</p>}
          {passwordNotice && <p className="ess-message good" role="status"><CheckCircle2 size={16} /> {passwordNotice}</p>}
          <button className="primary-button brand" type="submit" disabled={passwordBusy || !currentPassword || !nextPassword || !confirmPassword}>
            <ShieldCheck size={17} /> {passwordBusy ? "Updating password…" : "Update password"}
          </button>
        </form>
      </section>
    </div>
  );
}

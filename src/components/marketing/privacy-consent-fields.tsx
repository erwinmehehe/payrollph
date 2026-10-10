"use client";
import Link from "next/link";

export function PrivacyConsentFields({ accepted, onAcceptedChange, website, onWebsiteChange }: {
  accepted: boolean;
  onAcceptedChange: (checked: boolean) => void;
  website: string;
  onWebsiteChange: (value: string) => void;
}) {
  return (
    <div className="mt-4">
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>Leave website blank
          <input name="website" type="text" value={website} onChange={(event) => onWebsiteChange(event.target.value)} tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-start gap-3 text-[12.5px] leading-relaxed text-[#4C516C]">
        <input type="checkbox" name="privacyConsent" checked={accepted} onChange={(event) => onAcceptedChange(event.target.checked)}
          required className="mt-1 h-4 w-4 shrink-0 accent-[#0877ff]" />
        <span>I agree to Linaw using my contact and company details to respond to this enquiry, as explained in the{" "}
          <Link href="/privacy" className="font-semibold text-[#0868dc] underline underline-offset-2">privacy notice</Link>.
          This is not consent to unrelated promotional email.</span>
      </label>
    </div>
  );
}

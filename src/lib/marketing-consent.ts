/** Public enquiry consent is only for responding to the submitted enquiry. */
export const MARKETING_PRIVACY_NOTICE_VERSION = "2026-10-10";
export function hasMarketingEnquiryConsent(input: unknown): boolean {
  return Boolean(input && typeof input === "object" && (input as Record<string, unknown>).privacyConsent === true);
}
export function marketingHoneypotTripped(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const value = (input as Record<string, unknown>).website;
  return value !== null && value !== undefined && String(value).trim().length > 0;
}
export function marketingConsentEvidence(now: Date = new Date()): Record<string, string> {
  return {
    privacyConsentVersion: MARKETING_PRIVACY_NOTICE_VERSION,
    privacyConsentAt: now.toISOString(),
    privacyConsentPurpose: "requested-enquiry-follow-up",
  };
}

/**
 * Never return raw Drizzle/PostgreSQL exceptions or user-supplied identifiers.
 * The browser only receives these deliberately authored, non-sensitive errors.
 * No logger is called here; sensitive metadata stays out of browser responses.
 */
const PREVIEW_ERRORS: Readonly<Record<string, string>> = {
  "MULTI_ENTITY_PREVIEW_REQUIRES_SCOPED_AUTHORIZATION":
    "Multiple legal employers require separately authorized payroll preview. Ask an administrator to select the correct employer.",
  "Employer not found.": "The selected employer could not be found.",
};

const PROGRESS_ERRORS: ReadonlySet<string> = new Set([
  "Company-wide authorized membership required.",
  "HR must expressly attest valid calendar dates for this payroll period.",
  "Employer confirmation requires an administrator.",
  "Invalid owner role for this step.",
  "An active primary legal employer is required.",
  "Only the responsible role or an employer administrator may hand off this step.",
  "Invite and activate a member with this role before handing off the step.",
]);

export function publicFirstPayrollPreviewError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return PREVIEW_ERRORS[message] ?? "First-payroll preview could not be calculated safely. Check the employer setup and pay period.";
}

export function publicFirstPayrollProgressError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return PROGRESS_ERRORS.has(message)
    ? message
    : "Could not record this first-payroll step. Nothing has been confirmed.";
}

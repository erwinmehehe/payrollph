/**
 * Employee identity fields that ESS accepts as change requests.
 * Core statutory values already exist on employees; optional credentials live
 * separately and never affect payroll calculations.
 *
 * Never collect a PhilSys Number (PSN) here. The publicly printable PCN is a
 * distinct number and needs its own approved handling policy if added later.
 */
export const ESS_IDENTIFIER_FIELDS = {
  sssNo: { label: "SSS number", hint: "10 digits", payroll: true, inputMode: "numeric" },
  tin: { label: "BIR TIN", hint: "9 or 12 digits", payroll: true, inputMode: "numeric" },
  tinBranchCode: { label: "TIN branch code", hint: "3 or 4 digits (if applicable)", payroll: true, inputMode: "numeric" },
  philHealthNo: { label: "PhilHealth PIN", hint: "12 digits", payroll: true, inputMode: "numeric" },
  pagIbigNo: { label: "Pag-IBIG MID", hint: "12 digits", payroll: true, inputMode: "numeric" },
  passportNo: { label: "Passport number", hint: "6–16 letters or digits", payroll: false, inputMode: "text" },
  driversLicenseNo: { label: "Driver's license", hint: "7–20 letters or digits", payroll: false, inputMode: "text" },
  prcLicenseNo: { label: "PRC license number", hint: "4–16 letters or digits", payroll: false, inputMode: "text" },
  umidNo: { label: "UMID / CRN", hint: "12 digits", payroll: false, inputMode: "numeric" },
} as const;

export type EssIdentifierKind = keyof typeof ESS_IDENTIFIER_FIELDS;

export const ESS_IDENTIFIER_KINDS = Object.keys(ESS_IDENTIFIER_FIELDS) as EssIdentifierKind[];

export const ESS_CORE_IDENTIFIER_KINDS: EssIdentifierKind[] = [
  "sssNo", "tin", "tinBranchCode", "philHealthNo", "pagIbigNo",
];

export function isEssIdentifierKind(value: unknown): value is EssIdentifierKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ESS_IDENTIFIER_FIELDS, value);
}

export function normalizeEssIdentifier(kind: EssIdentifierKind, raw: unknown):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.length > 100) {
    return { ok: false, error: "Enter a valid ID number." };
  }
  // Dashes, periods and spaces are display separators only.
  const value = raw.trim().toUpperCase().replace(/[\s.\-]/g, "");
  const digits = {
    sssNo: /^\d{10}$/,
    tin: /^\d{9}(?:\d{3})?$/,
    tinBranchCode: /^\d{3,4}$/,
    philHealthNo: /^\d{12}$/,
    pagIbigNo: /^\d{12}$/,
    umidNo: /^\d{12}$/,
  } as const;
  const optional = {
    passportNo: /^[A-Z0-9]{6,16}$/,
    driversLicenseNo: /^[A-Z0-9]{7,20}$/,
    prcLicenseNo: /^[A-Z0-9]{4,16}$/,
  } as const;
  const rule = (kind in digits ? digits[kind as keyof typeof digits] : optional[kind as keyof typeof optional]) as RegExp;
  return rule.test(value)
    ? { ok: true, value }
    : { ok: false, error: `Check the ${ESS_IDENTIFIER_FIELDS[kind].label} format (${ESS_IDENTIFIER_FIELDS[kind].hint}).` };
}

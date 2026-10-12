/**
 * Validated registration changes. The result is encrypted before any DB write.
 * No masked placeholder, null, or hidden field may silently clear a legal ID.
 */
export const EMPLOYER_PROFILE_FIELDS = [
  "legalName", "registeredAddress", "birTin", "birBranchCode",
  "sssEmployerNo", "philHealthEmployerNo", "pagIbigEmployerNo",
  "disbursementBankCode", "disbursementAccountName", "disbursementAccount",
] as const;
export type EmployerProfileField = typeof EMPLOYER_PROFILE_FIELDS[number];
export type EmployerProfileChanges = Partial<Record<EmployerProfileField, string>>;
export type ProfileValidation =
  | { ok: true; changes: EmployerProfileChanges; changedFields: EmployerProfileField[] }
  | { ok: false; error: string };

const limits: Record<EmployerProfileField, number> = {
  legalName: 200, registeredAddress: 2000, birTin: 9, birBranchCode: 4,
  sssEmployerNo: 24, philHealthEmployerNo: 24, pagIbigEmployerNo: 24,
  disbursementBankCode: 16, disbursementAccountName: 160,
  disbursementAccount: 34,
};

export function validateEmployerProfileChanges(input: unknown): ProfileValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Changes must be an object." };
  const data = input as Record<string, unknown>;
  const keys = Object.keys(data);
  if (!keys.length || keys.length > EMPLOYER_PROFILE_FIELDS.length ||
      keys.some(key => !EMPLOYER_PROFILE_FIELDS.includes(key as EmployerProfileField)))
    return { ok: false, error: "Unknown or missing employer profile fields." };
  const changes: EmployerProfileChanges = {};
  for (const key of keys as EmployerProfileField[]) {
    const raw = data[key];
    if (typeof raw !== "string") return { ok: false, error: "Employer profile changes must be text." };
    let value = raw.trim();
    if (key === "birTin") value = value.replace(/[\s-]/g, "");
    if (key === "birBranchCode") value = value.replace(/\D/g, "").padStart(4, "0");
    if (key === "disbursementBankCode") value = value.toUpperCase();
    if (key === "disbursementAccount") value = value.replace(/\s/g, "");
    if (!value || value.length > limits[key] || value.includes("••••"))
      return { ok: false, error: "Employer registration values cannot be blank, masked or too long." };
    if (key === "legalName" && value.length < 3)
      return { ok: false, error: "Registered legal name is too short." };
    if (key === "registeredAddress" && value.length < 5)
      return { ok: false, error: "Registered address is too short." };
    if (key === "birTin" && !/^\d{9}$/.test(value))
      return { ok: false, error: "Employer TIN must contain 9 digits." };
    if (key === "birBranchCode" && !/^\d{4}$/.test(value))
      return { ok: false, error: "Invalid employer BIR branch code." };
    if (["sssEmployerNo", "philHealthEmployerNo", "pagIbigEmployerNo"].includes(key) &&
        !/^[A-Za-z0-9-]+$/.test(value))
      return { ok: false, error: "Invalid employer agency registration format." };
    if (key === "disbursementBankCode" && !/^[A-Z0-9_-]{2,16}$/.test(value))
      return { ok: false, error: "Invalid bank code." };
    if (key === "disbursementAccountName" && value.length < 2)
      return { ok: false, error: "Bank account holder name is too short." };
    if (key === "disbursementAccount" && !/^[0-9]{6,34}$/.test(value))
      return { ok: false, error: "Bank account number must contain 6–34 digits." };
    changes[key] = value;
  }
  const bankFields = ["disbursementBankCode", "disbursementAccountName", "disbursementAccount"] as const;
  if (bankFields.some(key => Object.hasOwn(changes, key)) &&
      !bankFields.every(key => Object.hasOwn(changes, key)))
    return { ok: false, error: "Bank destination changes require bank code, account name and account number together." };
  return { ok: true, changes, changedFields: keys as EmployerProfileField[] };
}

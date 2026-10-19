/**
 * The BIR 1601-C screen must not mistake a malformed or cross-employer 200
 * for a genuine empty reconciliation list or an authorized payment control.
 */
export type FilingCheck = {
  state: "missing" | "metadata_missing" | "mismatch" | "matched";
  matched: boolean;
  message: string;
  filing: {
    id: number;
    agencyReference: string | null;
    submittedAt: string | null;
    employeeCount: number | null;
    reportedTotal: string | null;
  } | null;
  comparison: {
    totalMatches: boolean;
    employeeCountMatches: boolean;
    totalDifference: number | null;
    employeeCountDifference: number | null;
  } | null;
};

export type Batch = {
  id: number;
  organizationId: number;
  legalEntityId: number;
  applicableMonth: string;
  filingChannel: "non_efps" | "efps";
  efpsGroup: string | null;
  filingDueDate: string;
  paymentDueDate: string;
  status: string;
  displayStatus: string;
  employeeCount: number;
  payrollRunCount: number;
  expectedTaxWithheld: string;
  amountPaid: string | null;
  paymentReference: string | null;
  filingReference: string | null;
  filingCheck: FilingCheck;
};

type ReadResponse = {
  organizationId: number;
  legalEntity: { id: number; code: string | null; displayName: string };
  batches: Batch[];
  today: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): value is number =>
  integer(value) && value > 0;
const str = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const nullableStr = (value: unknown): boolean => value === null || typeof value === "string";
const money = (value: unknown): value is string =>
  typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) &&
  Number.isFinite(Number(value));
const nullableMoney = (value: unknown): boolean => value === null || money(value);
const date = (value: unknown): boolean =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const month = (value: unknown): boolean =>
  typeof value === "string" && /^\d{4}-\d{2}$/.test(value);

function validCheck(value: unknown): value is FilingCheck {
  if (!object(value) || !["missing", "metadata_missing", "mismatch", "matched"].includes(String(value.state)) ||
      typeof value.matched !== "boolean" || !str(value.message) ||
      value.matched !== (value.state === "matched")) return false;
  if (value.filing !== null) {
    if (!object(value.filing) || !positive(value.filing.id) ||
        !nullableStr(value.filing.agencyReference) ||
        !nullableStr(value.filing.submittedAt) ||
        !(value.filing.employeeCount === null || integer(value.filing.employeeCount)) ||
        !nullableMoney(value.filing.reportedTotal)) return false;
  }
  if (value.comparison !== null) {
    if (!object(value.comparison) ||
        typeof value.comparison.totalMatches !== "boolean" ||
        typeof value.comparison.employeeCountMatches !== "boolean" ||
        !(value.comparison.totalDifference === null || (typeof value.comparison.totalDifference === "number" && Number.isFinite(value.comparison.totalDifference))) ||
        !(value.comparison.employeeCountDifference === null || (typeof value.comparison.employeeCountDifference === "number" && Number.isFinite(value.comparison.employeeCountDifference))))
      return false;
  }
  if (value.state === "matched" &&
      (value.filing === null || value.comparison === null ||
       !(value.comparison as Record<string, unknown>).totalMatches ||
       !(value.comparison as Record<string, unknown>).employeeCountMatches)) return false;
  if (value.state === "mismatch" && value.comparison === null) return false;
  return true;
}

function validBatch(value: unknown, organizationId: number, legalEntityId: number): value is Batch {
  return object(value) &&
    positive(value.id) && value.organizationId === organizationId &&
    value.legalEntityId === legalEntityId &&
    month(value.applicableMonth) &&
    (value.filingChannel === "efps" || value.filingChannel === "non_efps") &&
    nullableStr(value.efpsGroup) &&
    date(value.filingDueDate) && date(value.paymentDueDate) &&
    str(value.status) && str(value.displayStatus) &&
    integer(value.employeeCount) && integer(value.payrollRunCount) &&
    money(value.expectedTaxWithheld) && nullableMoney(value.amountPaid) &&
    nullableStr(value.paymentReference) && nullableStr(value.filingReference) &&
    validCheck(value.filingCheck);
}

/** Returns null on partial, malformed or foreign success. [] means verified empty. */
export function parseBir1601cRead(value: unknown, expectedOrganizationId: number): Batch[] | null {
  if (!positive(expectedOrganizationId) || !object(value) ||
      value.organizationId !== expectedOrganizationId ||
      !object(value.legalEntity) || !positive(value.legalEntity.id) ||
      !nullableStr(value.legalEntity.code) || !str(value.legalEntity.displayName) ||
      !date(value.today) || !Array.isArray(value.batches)) return null;
  const entityId = value.legalEntity.id;
  if (!value.batches.every((row: unknown) => validBatch(row, expectedOrganizationId, entityId))) return null;
  const ids = (value.batches as Batch[]).map((b) => b.id);
  if (new Set(ids).size !== ids.length) return null;
  return value.batches as Batch[];
}

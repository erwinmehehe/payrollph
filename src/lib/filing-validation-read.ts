/**
 * Verified filing evidence reads. A 200 status cannot turn missing forms,
 * foreign-employer rows or absent agency evidence into "no filings" or actions.
 * This client contract never grants server-side authorization.
 */
export type FilingRecord = {
  id: number;
  organizationId: number;
  legalEntityId: number;
  payrollRunId: number | null;
  agency: string;
  form: string;
  periodLabel: string;
  applicableMonth: string | null;
  employeeCount: number | null;
  reportedTotal: string | null;
  fileName: string;
  fileSha256: string;
  generatorVersion: string;
  status: "generated" | "accepted" | "rejected";
  submissionMethod: "file_upload" | "manual_entry" | null;
  agencyReference: string | null;
  submittedAt: string | null;
  outcomeNote: string | null;
  generatedBy: string;
  recordedBy: string | null;
  recordedAt: string | null;
  createdAt: string;
};

export type FilingForm = {
  agency: string;
  form: string;
  generatorVersion: string;
  referenceLabel: string;
  evidenceMode: "file-format" | "operational";
  submissionMethods: Array<"file_upload" | "manual_entry">;
  requiresFinalCutoff?: boolean;
  official?: {
    workflow: string;
    officialInstructionsUrl: string;
    officialPortalUrl: string;
    acceptanceEvidence: string;
    acceptanceChecklist: string[];
    worksheetStatus: "reconciliation-only";
    notes: string;
  } | null;
  relatedCertificate?: {
    form: string;
    officialInstructionsUrl: string;
    acceptanceChecklist: string[];
    notes: string;
  } | null;
  copy: {
    title: string;
    agencyLabel: string;
    portalLabel: string;
    methodLabels: { file_upload: string; manual_entry: string };
    manualEntryNote: string;
    answerLabel: string;
    scopeNote: string | null;
    unconfirmedNote: string;
  };
};

export type FilingReadScope = {
  organizationId: number;
  legalEntityId: number;
  agency: string;
  form: string;
};

export type VerifiedFilingRead = {
  records: FilingRecord[];
  definition: FilingForm;
};

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const nonnegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const nonempty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const nullable = (v: unknown): v is string | null =>
  v === null || typeof v === "string";
const isMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const isMoney = (v: unknown): v is string =>
  typeof v === "string" && /^\d+(?:\.\d{1,4})?$/.test(v) && Number.isFinite(Number(v));
const timeOrNull = (v: unknown): v is string | null =>
  v === null || (nonempty(v) && !Number.isNaN(Date.parse(v)));
const method = (v: unknown): v is "file_upload" | "manual_entry" =>
  v === "file_upload" || v === "manual_entry";
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(nonempty);

function validOfficial(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  return object(v) && nonempty(v.workflow) &&
    nonempty(v.officialInstructionsUrl) && nonempty(v.officialPortalUrl) &&
    nonempty(v.acceptanceEvidence) && strings(v.acceptanceChecklist) &&
    v.worksheetStatus === "reconciliation-only" && nonempty(v.notes);
}

function validCertificate(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  return object(v) && nonempty(v.form) && nonempty(v.officialInstructionsUrl) &&
    strings(v.acceptanceChecklist) && nonempty(v.notes);
}

function validForm(v: unknown): v is FilingForm {
  return object(v) &&
    nonempty(v.agency) && nonempty(v.form) && nonempty(v.generatorVersion) &&
    nonempty(v.referenceLabel) &&
    (v.evidenceMode === "operational" || v.evidenceMode === "file-format") &&
    Array.isArray(v.submissionMethods) && v.submissionMethods.length > 0 &&
    v.submissionMethods.every(method) &&
    new Set(v.submissionMethods).size === v.submissionMethods.length &&
    (v.requiresFinalCutoff === undefined || typeof v.requiresFinalCutoff === "boolean") &&
    validOfficial(v.official) && validCertificate(v.relatedCertificate) &&
    object(v.copy) && nonempty(v.copy.title) &&
    nonempty(v.copy.agencyLabel) && nonempty(v.copy.portalLabel) &&
    object(v.copy.methodLabels) && nonempty(v.copy.methodLabels.file_upload) &&
    nonempty(v.copy.methodLabels.manual_entry) && nonempty(v.copy.manualEntryNote) &&
    nonempty(v.copy.answerLabel) &&
    (v.copy.scopeNote === null || typeof v.copy.scopeNote === "string") &&
    nonempty(v.copy.unconfirmedNote);
}

function validRow(v: unknown, expected: FilingReadScope): v is FilingRecord {
  if (!object(v) || !positive(v.id) ||
      v.organizationId !== expected.organizationId ||
      v.legalEntityId !== expected.legalEntityId ||
      !(v.payrollRunId === null || positive(v.payrollRunId)) ||
      !nonempty(v.agency) || !nonempty(v.form) || !nonempty(v.periodLabel) ||
      !(v.applicableMonth === null || isMonth(v.applicableMonth)) ||
      !(v.employeeCount === null || nonnegative(v.employeeCount)) ||
      !(v.reportedTotal === null || isMoney(v.reportedTotal)) ||
      !nonempty(v.fileName) ||
      typeof v.fileSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(v.fileSha256) ||
      !nonempty(v.generatorVersion) ||
      !["generated", "accepted", "rejected"].includes(String(v.status)) ||
      !(v.submissionMethod === null || method(v.submissionMethod)) ||
      !nullable(v.agencyReference) || !timeOrNull(v.submittedAt) ||
      !nullable(v.outcomeNote) || !nonempty(v.generatedBy) ||
      !nullable(v.recordedBy) || !timeOrNull(v.recordedAt) ||
      !nonempty(v.createdAt) || Number.isNaN(Date.parse(v.createdAt))) return false;

  // An incomplete historical claim cannot surface as accepted filing evidence.
  return v.status !== "accepted" ||
    (method(v.submissionMethod) && nonempty(v.agencyReference) &&
     v.agencyReference.trim().length >= 4 && nonempty(v.submittedAt));
}

export function parseFilingValidationRead(value: unknown, expected: FilingReadScope): VerifiedFilingRead | null {
  if (!positive(expected.organizationId) || !positive(expected.legalEntityId) ||
      !nonempty(expected.agency) || !nonempty(expected.form) ||
      !object(value) || (value.organizationId !== undefined &&
        value.organizationId !== expected.organizationId) ||
      !object(value.legalEntity) || value.legalEntity.id !== expected.legalEntityId ||
      !nonempty(value.legalEntity.displayName) ||
      !(value.legalEntity.code === null || typeof value.legalEntity.code === "string") ||
      !Array.isArray(value.forms) || value.forms.length === 0 ||
      value.forms.length > 30 || !value.forms.every(validForm) ||
      !Array.isArray(value.records) || value.records.length > 100 ||
      !value.records.every((row: unknown) => validRow(row, expected))) return null;
  const forms: FilingForm[] = value.forms;
  const records: FilingRecord[] = value.records;
  const formKeys = forms.map((f) => f.agency + "/" + f.form);
  if (new Set(formKeys).size !== forms.length ||
      new Set(records.map((r) => r.id)).size !== records.length ||
      records.some((r) => !formKeys.includes(r.agency + "/" + r.form))) return null;
  const definition = forms.find((f) => f.agency === expected.agency && f.form === expected.form);
  return definition ? { records, definition } : null;
}

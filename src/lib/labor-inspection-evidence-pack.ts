import { createHash } from "node:crypto";

export const LABOR_INSPECTION_EVIDENCE_PACK_VERSION = "labor-inspection-pack-v1";

export type EvidenceSection<T = unknown> = {
  name: string;
  rowCount: number;
  sha256: string;
  rows: T[];
};

export type LaborInspectionEvidencePack = {
  schemaVersion: string;
  generatedAt: string;
  generatedBy: string;
  organization: {
    id: number;
    legalName: string;
  };
  range: {
    startDate: string;
    endDate: string;
    label: string;
  };
  boundaries: {
    certification: string;
    sensitiveData: string;
    scope: string;
  };
  sections: {
    workerRoster: EvidenceSection;
    payrollRegister: EvidenceSection;
    timeRecords: EvidenceSection;
    payslipIndex: EvidenceSection;
    thirteenthMonth: EvidenceSection;
    statutoryRemittances: EvidenceSection;
    finalPay: EvidenceSection;
    remediationRegister: EvidenceSection;
    activeFindings: EvidenceSection;
  };
  snapshot: {
    algorithm: "SHA-256";
    sha256: string;
    sectionHashes: Record<string, string>;
  };
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalize(value));
}

export function sha256Evidence(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function evidenceSection<T>(name: string, rows: T[]): EvidenceSection<T> {
  return {
    name,
    rowCount: rows.length,
    sha256: sha256Evidence({ name, rows }),
    rows,
  };
}

export function buildLaborInspectionEvidencePack(input: Omit<LaborInspectionEvidencePack, "schemaVersion" | "snapshot">) {
  const sectionEntries = Object.entries(input.sections);
  const sectionHashes = Object.fromEntries(sectionEntries.map(([name, section]) => [name, section.sha256]));

  const snapshotSha256 = sha256Evidence({
    schemaVersion: LABOR_INSPECTION_EVIDENCE_PACK_VERSION,
    organization: input.organization,
    range: input.range,
    boundaries: input.boundaries,
    sectionHashes,
  });

  return {
    schemaVersion: LABOR_INSPECTION_EVIDENCE_PACK_VERSION,
    ...input,
    snapshot: {
      algorithm: "SHA-256" as const,
      sha256: snapshotSha256,
      sectionHashes,
    },
  };
}

export function verifyLaborInspectionEvidencePack(pack: LaborInspectionEvidencePack) {
  const sectionEntries = Object.entries(pack.sections);
  const sectionHashes = Object.fromEntries(
    sectionEntries.map(([name, section]) => [name, sha256Evidence({ name: section.name, rows: section.rows })]),
  );
  const sectionsValid = sectionEntries.every(([name, section]) =>
    section.sha256 === sectionHashes[name]
    && section.rowCount === section.rows.length
  );

  const snapshotSha256 = sha256Evidence({
    schemaVersion: pack.schemaVersion,
    organization: pack.organization,
    range: pack.range,
    boundaries: pack.boundaries,
    sectionHashes,
  });

  return {
    valid: sectionsValid && snapshotSha256 === pack.snapshot.sha256,
    sectionsValid,
    snapshotValid: snapshotSha256 === pack.snapshot.sha256,
    expectedSnapshotSha256: snapshotSha256,
    sectionHashes,
  };
}

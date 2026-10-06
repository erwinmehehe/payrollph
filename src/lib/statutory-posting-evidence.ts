import { createHash } from "node:crypto";

export type PostingEvidenceSource = "csv_import" | "manual_confirmation";

export function postingCsvEvidence(input: {
  csv: string;
  fileName: string;
}) {
  const bytes = Buffer.from(input.csv, "utf8");
  return {
    sourceType: "csv_import" as const,
    fileName: input.fileName.slice(0, 200),
    mimeType: "text/csv",
    byteSize: bytes.byteLength,
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    fileDataBase64: bytes.toString("base64"),
  };
}

export function manualPostingEvidenceHash(input: {
  organizationId: number;
  batchId: number;
  memberId: number;
  postingReference: string;
  postedAmount: number;
  postedAt: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    organizationId: input.organizationId,
    batchId: input.batchId,
    memberId: input.memberId,
    postingReference: input.postingReference.trim(),
    postedAmount: Number(input.postedAmount.toFixed(2)),
    postedAt: new Date(input.postedAt).toISOString(),
  })).digest("hex");
}

export function postingEvidenceSourceLabel(sourceType: string | null | undefined) {
  if (sourceType === "csv_import") return "Imported agency evidence";
  if (sourceType === "manual_confirmation") return "Manual payroll confirmation";
  return "Evidence source unavailable";
}

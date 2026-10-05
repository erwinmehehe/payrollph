import { createHash } from "node:crypto";
import { parseCsv } from "@/lib/csv-import";

export type PostingImportRow = {
  sourceLine: number;
  employeeNo: string;
  postedAmount: number;
  postingReference: string;
  postedAt: string;
};

const COLUMN_ALIASES: Record<string, keyof PostingImportRow> = {
  "employee no": "employeeNo",
  employee_no: "employeeNo",
  employeeno: "employeeNo",
  employee: "employeeNo",
  "posted amount": "postedAmount",
  posted_amount: "postedAmount",
  amount: "postedAmount",
  "posting reference": "postingReference",
  posting_reference: "postingReference",
  reference: "postingReference",
  "posted at": "postedAt",
  posted_at: "postedAt",
  date: "postedAt",
};

function headerKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizedAmount(value: string) {
  return Number(value.replace(/[₱,s]/g, ""));
}

export function parseStatutoryPostingCsv(text: string) {
  const rows = parseCsv(text);
  const headers = rows[0] ?? [];
  if (rows.length < 2) {
    return {
      headers,
      valid: [] as PostingImportRow[],
      errors: [{ line: 1, problems: ["CSV needs a header row and at least one data row"] }],
      unmapped: headers,
      hash: createHash("sha256").update(text).digest("hex"),
    };
  }

  const mapping = new Map<number, Exclude<keyof PostingImportRow, "sourceLine">>();
  headers.forEach((header, index) => {
    const key = COLUMN_ALIASES[headerKey(header)];
    if (key) mapping.set(index, key);
  });

  const required = new Set<Exclude<keyof PostingImportRow, "sourceLine">>([
    "employeeNo",
    "postedAmount",
    "postingReference",
    "postedAt",
  ]);
  const mapped = new Set(mapping.values());
  const missing = [...required].filter((key) => !mapped.has(key));
  if (missing.length) {
    return {
      headers,
      valid: [] as PostingImportRow[],
      errors: [{
        line: 1,
        problems: [`Missing required column(s): ${missing.join(", ")}`],
      }],
      unmapped: headers.filter((header) => !COLUMN_ALIASES[headerKey(header)]),
      hash: createHash("sha256").update(text).digest("hex"),
    };
  }

  const valid: PostingImportRow[] = [];
  const errors: { line: number; problems: string[] }[] = [];
  const seenEmployees = new Set<string>();

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    const raw: Partial<Record<keyof PostingImportRow, string>> = {};
    for (const [cellIndex, key] of mapping) raw[key] = (cells[cellIndex] ?? "").trim();

    const problems: string[] = [];
    const employeeNo = raw.employeeNo ?? "";
    if (!employeeNo) problems.push("employeeNo is required");
    else if (employeeNo.length > 32) problems.push("employeeNo exceeds 32 characters");
    else if (seenEmployees.has(employeeNo)) problems.push(`Duplicate employeeNo "${employeeNo}" inside the upload`);

    const amountRaw = raw.postedAmount ?? "";
    const postedAmount = normalizedAmount(amountRaw);
    if (!amountRaw) problems.push("postedAmount is required");
    else if (!Number.isFinite(postedAmount)) problems.push(`postedAmount "${amountRaw}" is not a number`);
    else if (postedAmount < 0) problems.push("postedAmount cannot be negative");

    const postingReference = raw.postingReference ?? "";
    if (postingReference.length < 4) problems.push("postingReference must be at least 4 characters");

    const postedAt = raw.postedAt ?? "";
    const parsedDate = new Date(postedAt);
    if (!postedAt || !Number.isFinite(parsedDate.getTime())) {
      problems.push("postedAt must be a valid date or date-time");
    }

    if (problems.length) {
      errors.push({ line: index + 1, problems });
      continue;
    }

    seenEmployees.add(employeeNo);
    valid.push({
      sourceLine: index + 1,
      employeeNo,
      postedAmount,
      postingReference,
      postedAt: parsedDate.toISOString(),
    });
  }

  return {
    headers,
    valid,
    errors,
    unmapped: headers.filter((header) => !COLUMN_ALIASES[headerKey(header)] && header.trim()),
    hash: createHash("sha256").update(text).digest("hex"),
  };
}

export const STATUTORY_POSTING_TEMPLATE = [
  "employee_no,posted_amount,posting_reference,posted_at",
  "EMP-001,1500.00,AGENCY-POST-0001,2026-10-05",
  "EMP-002,1500.00,AGENCY-POST-0002,2026-10-05",
].join("\n");

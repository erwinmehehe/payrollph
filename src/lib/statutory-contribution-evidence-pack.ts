import { createHash } from "node:crypto";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

export function evidenceHash(value: JsonValue) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function buildContributionEvidencePack<T extends Record<string, JsonValue>>(payload: T) {
  const evidenceHashSha256 = evidenceHash(payload);
  return {
    ...payload,
    evidenceHashSha256,
  };
}

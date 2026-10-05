import { createHash } from "node:crypto";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function asJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Evidence payload cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(record)) {
      if (item === undefined) continue;
      normalized[key] = asJsonValue(item);
    }
    return normalized;
  }
  throw new Error(`Evidence payload contains unsupported value type: ${typeof value}.`);
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

export function evidenceHash(value: unknown) {
  return createHash("sha256").update(canonicalize(asJsonValue(value))).digest("hex");
}

export function buildContributionEvidencePack<T extends Record<string, unknown>>(
  payload: T,
): T & { evidenceHashSha256: string } {
  const evidenceHashSha256 = evidenceHash(payload);
  return {
    ...payload,
    evidenceHashSha256,
  };
}

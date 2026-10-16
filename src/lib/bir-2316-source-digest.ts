import { createHash } from "node:crypto";
import type { CertificateSource } from "./bir-2316-certificate";
/** Concurrency token, not an approval or authorization credential. */
export function certificateSourceDigest(source: CertificateSource) {
  const ordered = { ...source, withholding: source.withholding ? { ...source.withholding,
    entryIds: [...source.withholding.entryIds].sort((a,b) => a-b), issues: [...source.withholding.issues].sort() } : undefined };
  return createHash("sha256").update(JSON.stringify(ordered, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)));
    return value;
  })).digest("hex");
}

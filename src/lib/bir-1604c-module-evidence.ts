/**
 * BIR desktop-validator observations are NOT government filing receipts.
 *
 * Only an independently checked observation tied to exact generated DAT bytes,
 * selected employer/year, original source digest and validator version can
 * move the displayed module status away from "not run". No bank/PII payloads
 * or actual screenshots are stored in this read model.
 */
export type BirModuleAudit = {
  id: number;
  action: string;
  actor: string;
  metadata: unknown;
};
type Data = Record<string, unknown>;
const obj = (value: unknown): Data | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Data : null;
const digest = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
const reference = (value: unknown) => typeof value === "string" &&
  value.length >= 8 && value.length <= 160 && /^[\x20-\x7e]+$/.test(value) &&
  !/[\r\n]/.test(value);
const version = (value: unknown) => typeof value === "string" && /^7\.[0-9]{1,2}$/.test(value);
const calendarDay = (value: unknown) => {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    && date.valueOf() <= Date.now() + 86_400_000;
};

export function validateBirModuleObservation(input: unknown) {
  const data = obj(input);
  if (!data || !digest(data.fileSha256) || !digest(data.sourceDigest) ||
      !version(data.moduleVersion) || !reference(data.evidenceReference) ||
      !calendarDay(data.validatedOn) ||
      (data.outcome !== "pass" && data.outcome !== "fail")) return null;
  return {
    fileSha256: String(data.fileSha256).toLowerCase(),
    sourceDigest: String(data.sourceDigest).toLowerCase(),
    moduleVersion: String(data.moduleVersion),
    evidenceReference: String(data.evidenceReference),
    validatedOn: String(data.validatedOn),
    outcome: data.outcome as "pass" | "fail",
  };
}

export function birModuleEvidenceStatus(
  audits: BirModuleAudit[], sourceDigest: string, moduleVersion: string = "7.0",
) {
  const matching = audits.filter(item => obj(item.metadata)?.sourceDigest === sourceDigest)
    .sort((a, b) => a.id - b.id);
  const generated = new Map<string, BirModuleAudit>();
  let latestDownloadSha: string | null = null;
  const reported = new Map<number, BirModuleAudit>();
  const independentlyReviewed = new Map<number, BirModuleAudit>();
  for (const audit of matching) {
    const m = obj(audit.metadata);
    if (!m) continue;
    if (audit.action === "bir1604c.candidate.downloaded" && digest(m.fileSha256)) {
      latestDownloadSha = String(m.fileSha256).toLowerCase();
      generated.set(latestDownloadSha, audit);
    }
    if (audit.action === "bir1604c.validator.observed" &&
        validateBirModuleObservation(m) &&
        generated.has(String(m.fileSha256).toLowerCase()) &&
        audit.id > generated.get(String(m.fileSha256).toLowerCase())!.id) {
      reported.set(audit.id, audit);
    }
    if (audit.action === "bir1604c.validator.reviewed" &&
        typeof m.observationId === "number" && Number.isSafeInteger(m.observationId) &&
        (m.decision === "confirmed" || m.decision === "rejected") &&
        reference(m.evidenceReference)) {
      const source = reported.get(m.observationId);
      if (source && source.actor !== audit.actor && source.id < audit.id &&
          m.fileSha256 === obj(source.metadata)?.fileSha256) {
        independentlyReviewed.set(source.id, audit);
      }
    }
  }
  const reviewCandidates = [...independentlyReviewed].map(([id, review]) => ({
    observed: reported.get(id)!, reviewed: review,
  })).filter(item => obj(item.observed.metadata)?.moduleVersion === moduleVersion &&
    obj(item.observed.metadata)?.fileSha256 === latestDownloadSha);
  const latest = reviewCandidates.sort((a,b) => b.reviewed.id - a.reviewed.id)[0];
  const confirmed = latest && obj(latest.reviewed.metadata)?.decision === "confirmed"
    ? latest : null;
  const metadata = confirmed ? obj(confirmed.observed.metadata) : null;
  return {
    status: metadata?.outcome === "pass" ? "yes" as const
      : metadata?.outcome === "fail" ? "no" as const : "not run" as const,
    moduleVersion,
    fileSha256: metadata ? String(metadata.fileSha256) : null,
    evidenceReference: metadata ? String(metadata.evidenceReference) : null,
    validatedOn: metadata ? String(metadata.validatedOn) : null,
    independentlyReviewed: Boolean(confirmed),
    reportedAwaitingReview: [...reported.values()].some(item =>
      obj(item.metadata)?.moduleVersion === moduleVersion &&
      obj(item.metadata)?.fileSha256 === latestDownloadSha &&
      !independentlyReviewed.has(item.id)),
    note: "Operator-recorded independent review of official module evidence. This is not BIR agency submission acceptance.",
  };
}

/** Find candidate download for this employer/year without trusting client totals. */
export function birCandidateDownloadExists(
  audits: BirModuleAudit[], sourceDigest: string, fileSha256: string,
) {
  return audits.some(item => item.action === "bir1604c.candidate.downloaded" &&
    obj(item.metadata)?.sourceDigest === sourceDigest &&
    obj(item.metadata)?.fileSha256 === fileSha256);
}

import { createHash } from "node:crypto";
import { receiptPilotAllowed, validReceiptId } from "./workforce-schedule-receipt";

/**
 * Aggregate workload only. Never ingest people, order IDs, cardholder data,
 * individual appointments, IPs, GPS traces or arbitrary provider JSON.
 */
export const DEMAND_METRICS = ["transactions", "visits", "orders", "appointments", "calls"] as const;
export type DemandMetric = typeof DEMAND_METRICS[number];
export type DemandQuality = "complete" | "partial" | "unverified";
export type DemandImportRow = {
  intervalStart: string;
  observedCount: number;
  quality: DemandQuality;
  revision: number;
};
export type DemandImport = {
  organizationId: number;
  worksiteId: number;
  sourceKey: string;
  metricKind: DemandMetric;
  intervalMinutes: 15 | 30 | 60;
  idempotencyKey: string;
  acknowledged: true;
  rows: DemandImportRow[];
};
const ISO_PH = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):00\+08:00$/;
const SOURCE = /^[a-z][a-z0-9._-]{2,63}$/;
const IDEMPOTENCY = /^[a-zA-Z0-9_-]{12,64}$/;
const MAX_ROWS = 100;
const AGE_DAYS = 366;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key))
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
export function parseDemandImport(input: unknown, now = new Date()): DemandImport {
  if (!record(input) || !exactKeys(input, [
    "organizationId", "worksiteId", "sourceKey", "metricKind",
    "intervalMinutes", "idempotencyKey", "acknowledged", "rows",
  ])) throw new Error("Only aggregate operational demand fields are accepted.");
  if (!validReceiptId(input.organizationId) || !validReceiptId(input.worksiteId)
    || typeof input.sourceKey !== "string" || !SOURCE.test(input.sourceKey)
    || typeof input.idempotencyKey !== "string" || !IDEMPOTENCY.test(input.idempotencyKey)
    || !DEMAND_METRICS.includes(input.metricKind as DemandMetric)
    || ![15, 30, 60].includes(Number(input.intervalMinutes))
    || ![15, 30, 60].includes(input.intervalMinutes as number)
    || input.acknowledged !== true
    || !Array.isArray(input.rows)
    || input.rows.length < 1 || input.rows.length > MAX_ROWS
    || !Number.isFinite(now.getTime())) {
    throw new Error("Invalid employer, worksite, source, metric, interval, or explicit import acknowledgement.");
  }
  const seen = new Set<string>();
  const rows: DemandImportRow[] = [];
  for (const value of input.rows) {
    if (!record(value) || !exactKeys(value, [
      "intervalStart", "observedCount", "quality", "revision",
    ]) || typeof value.intervalStart !== "string") {
      throw new Error("An observation must contain only interval, count, quality and revision.");
    }
    const match = ISO_PH.exec(value.intervalStart);
    const parsed = match ? Date.parse(value.intervalStart) : Number.NaN;
    if (!match || !Number.isFinite(parsed)
      || new Date(parsed + 8 * 3600_000).toISOString().slice(0, 19)
          !== value.intervalStart.slice(0, 19)
      || Number(match[2]) * 60 + Number(match[3]) + Number(input.intervalMinutes) > 1440
      || (Number(match[2]) * 60 + Number(match[3])) % Number(input.intervalMinutes) !== 0
      || parsed + Number(input.intervalMinutes) * 60_000 > now.getTime()
      || parsed < now.getTime() - AGE_DAYS * 86_400_000) {
      throw new Error("Demand intervals must be complete, PH-local, aligned and within the prior year.");
    }
    if (!Number.isSafeInteger(value.observedCount) ||
      Number(value.observedCount) < 0 || Number(value.observedCount) > 1_000_000
      || !["complete", "partial", "unverified"].includes(String(value.quality))
      || !Number.isSafeInteger(value.revision) ||
      Number(value.revision) < 1 || Number(value.revision) > 1000) {
      throw new Error("Demand counts, quality or correction revision are invalid.");
    }
    if (seen.has(value.intervalStart)) throw new Error("Duplicate interval in a single import.");
    seen.add(value.intervalStart);
    rows.push({
      intervalStart: value.intervalStart,
      observedCount: value.observedCount as number,
      quality: value.quality as DemandQuality,
      revision: value.revision as number,
    });
  }
  rows.sort((a, b) => a.intervalStart.localeCompare(b.intervalStart));
  return {
    organizationId: input.organizationId as number,
    worksiteId: input.worksiteId as number,
    sourceKey: input.sourceKey as string,
    metricKind: input.metricKind as DemandMetric,
    intervalMinutes: input.intervalMinutes as 15 | 30 | 60,
    idempotencyKey: input.idempotencyKey as string,
    acknowledged: true, rows,
  };
}

export function demandImportDigest(value: DemandImport): string {
  const normalized = { ...value, rows: [...value.rows].sort((a, b) =>
    a.intervalStart.localeCompare(b.intervalStart)) };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function operationalDemandPilotAllowed(organizationId: number) {
  return receiptPilotAllowed(organizationId,
    process.env.WFM_OPERATIONAL_DEMAND_ENABLED,
    process.env.WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS);
}

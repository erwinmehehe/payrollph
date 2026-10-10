import { createHash } from "node:crypto";
import { rosterDateOffset } from "@/lib/workforce-team-roster";

export type RosterBatchProposal = {
  organizationId: number;
  workDate: string;
  shiftDefinitionId: number;
  employeeIds: number[];
  reason: string;
  idempotencyKey: string;
};

export function rosterBulkPublishEnabled() {
  // Default OFF, server-side only. Never use NEXT_PUBLIC_ as authorization.
  return process.env.WFM_BULK_ROSTER_PUBLISH_ENABLED === "true";
}

export function safeSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function parseRosterBatchProposal(body: Record<string, unknown>, phToday: string): RosterBatchProposal {
  const organizationId = body.organizationId;
  const workDate = body.workDate;
  const shiftDefinitionId = body.shiftDefinitionId;
  const rawIds = body.employeeIds;
  const reason = body.reason;
  const idempotencyKey = body.idempotencyKey;
  if (!Number.isSafeInteger(organizationId) || Number(organizationId) <= 0
    || !Number.isSafeInteger(shiftDefinitionId) || Number(shiftDefinitionId) <= 0
    || typeof workDate !== "string" || typeof reason !== "string"
    || typeof idempotencyKey !== "string") {
    throw new Error("Organization, work date, active shift, reason and idempotency key are required.");
  }
  if (body.acknowledged !== true) {
    throw new Error("Explicit payroll/roster impact acknowledgement is required.");
  }
  if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 20
    || !rawIds.every(id => Number.isSafeInteger(id) && Number(id) > 0)
    || new Set(rawIds).size !== rawIds.length) {
    throw new Error("Select 1–20 unique authorized workers from the roster.");
  }
  const after = rosterDateOffset(phToday, 1);
  const max = rosterDateOffset(phToday, 35);
  rosterDateOffset(workDate, 0); // Reject nonexistent calendar dates before lexical bounds.
  if (workDate < after || workDate > max) {
    throw new Error("Bulk roster publication requires a future Philippine work date within 35 days.");
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 12 || trimmedReason.length > 240) {
    throw new Error("Document the shift change with a reason of 12–240 characters.");
  }
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(idempotencyKey)) {
    throw new Error("An unpredictable unique request key of 16–80 characters is required.");
  }
  return {
    organizationId: Number(organizationId),
    workDate,
    shiftDefinitionId: Number(shiftDefinitionId),
    employeeIds: [...rawIds].sort((a: number, b: number) => a - b),
    reason: trimmedReason,
    idempotencyKey,
  };
}

export function rosterBatchRequestSha(input: RosterBatchProposal) {
  return safeSha256([
    input.organizationId, input.workDate, input.shiftDefinitionId,
    input.employeeIds, input.reason,
  ]);
}

export function parseRecordedBatchEmployeeIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20
    || value.some(x => !Number.isSafeInteger(x) || x <= 0)
    || new Set(value).size !== value.length) {
    throw new Error("Recorded roster batch has invalid employee IDs.");
  }
  return [...value].sort((a: number, b: number) => a - b);
}

export function canReviewRosterBatch(makerUserId: number, checkerUserId: number): boolean {
  return Number.isSafeInteger(makerUserId) && Number.isSafeInteger(checkerUserId)
    && makerUserId > 0 && checkerUserId > 0 && makerUserId !== checkerUserId;
}

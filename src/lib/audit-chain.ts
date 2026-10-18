import { sql } from "drizzle-orm";
import { db } from "@/db";
import { Client } from "pg";
import { dispatchAuditSealing } from "./audit-sealer-connection";

export const AUDIT_CHAIN_GENESIS_HASH = "0".repeat(64);

export type AuditChainRow = {
  id: number;
  chainSeq: number | null;
  prevHash: string | null;
  rowHash: string | null;
  expectedHash: string | null;
};

export type AuditChainHead = { lastSeq: number; lastHash: string };

export type AuditChainBreak = {
  eventId: number;
  chainSeq: number | null;
  // eventId=0 is the sentinel for a stored head with no matching audit row.
  reason: "row_altered" | "link_broken" | "sequence_gap" | "head_missing" | "head_mismatch" | "pending_evidence";
};

export type AuditChainReport = {
  verified: boolean;
  chainedEvents: number;
  pendingSealEvents: number;
  headSeq: number | null;
  headHash: string | null;
  breaks: AuditChainBreak[];
};

/**
 * Walks chained rows in chain_seq order. expectedHash is recomputed by the
 * database with the same audit_event_row_hash() the insert trigger used, so
 * jsonb canonicalization never has to be reproduced in TypeScript.
 */
export function evaluateAuditChain(
  rows: AuditChainRow[],
  persistedHead?: AuditChainHead | null,
): AuditChainReport {
  const chained = rows
    .filter((row) => row.chainSeq != null)
    .sort((left, right) => Number(left.chainSeq) - Number(right.chainSeq));
  const breaks: AuditChainBreak[] = [];

  let previousHash = AUDIT_CHAIN_GENESIS_HASH;
  let expectedSeq = 1;
  for (const row of chained) {
    if (!Number.isSafeInteger(row.chainSeq) || (row.chainSeq ?? 0) < 1 || row.chainSeq !== expectedSeq) {
      breaks.push({ eventId: row.id, chainSeq: row.chainSeq, reason: "sequence_gap" });
    }
    if (row.prevHash !== previousHash) {
      breaks.push({ eventId: row.id, chainSeq: row.chainSeq, reason: "link_broken" });
    }
    if (!row.rowHash || row.rowHash !== row.expectedHash) {
      breaks.push({ eventId: row.id, chainSeq: row.chainSeq, reason: "row_altered" });
    }
    previousHash = row.rowHash ?? "";
    expectedSeq = Number(row.chainSeq) + 1;
  }

  // Unsealed rows must not carry partial or prefilled chain evidence.
  for (const row of rows) {
    if (row.chainSeq === null &&
        (row.prevHash !== null || row.rowHash !== null || row.expectedHash !== null)) {
      breaks.push({ eventId: row.id, chainSeq: null, reason: "pending_evidence" });
    }
  }

  const head = chained.at(-1);
  // A hash-valid suffix/prefix is not proof of complete history: removing the
  // last sealed event leaves every remaining row hash internally valid. Match
  // the persisted head, including the empty-chain genesis case. undefined
  // preserves the pure legacy evaluator contract for callers with no DB head.
  if (persistedHead !== undefined) {
    if (head && !persistedHead) {
      breaks.push({ eventId: head.id, chainSeq: head.chainSeq, reason: "head_missing" });
    } else if (persistedHead) {
      const expectedHeadSeq = head?.chainSeq ?? 0;
      const expectedHeadHash = head?.rowHash ?? AUDIT_CHAIN_GENESIS_HASH;
      if (!Number.isSafeInteger(persistedHead.lastSeq) || persistedHead.lastSeq < 0 ||
          !/^[a-f0-9]{64}$/.test(persistedHead.lastHash) ||
          persistedHead.lastSeq !== expectedHeadSeq ||
          persistedHead.lastHash !== expectedHeadHash) {
        breaks.push({
          eventId: head?.id ?? 0,
          chainSeq: head?.chainSeq ?? null,
          reason: "head_mismatch",
        });
      }
    }
  }
  return {
    verified: breaks.length === 0,
    chainedEvents: chained.length,
    pendingSealEvents: rows.length - chained.length,
    headSeq: head?.chainSeq ?? null,
    headHash: head?.rowHash ?? null,
    breaks,
  };
}

/**
 * Appends committed, unsealed audit rows to their organization's hash chain.
 * Runs outside application transactions and returns 0 when another sealer
 * holds the lock, so it is safe to call from the scheduler and the verifier.
 */
export async function sealAuditEvents(maxRows = 500): Promise<number> {
  return dispatchAuditSealing(async () => {
    const result = await db.execute(sql`SELECT seal_audit_events(${maxRows}) AS sealed`);
    return Number((result.rows[0] as { sealed?: unknown } | undefined)?.sealed ?? 0);
  }, (config) => new Client(config), maxRows);
}

export async function verifyAuditChain(organizationId: number): Promise<AuditChainReport> {
  // One PostgreSQL statement gives events and the authoritative chain head
  // the SAME MVCC snapshot. Two separate reads could falsely report a gap if
  // a concurrent sealer committed between them. The singleton row retains
  // head-only and genuinely empty organizations without querying other tenants.
  const result = await db.execute(sql`
    SELECT
      e.id,
      e.chain_seq AS "chainSeq",
      e.prev_hash AS "prevHash",
      e.row_hash AS "rowHash",
      CASE WHEN e.chain_seq IS NULL THEN NULL ELSE audit_event_row_hash(
        e.prev_hash, e.chain_seq, e.id, e.organization_id, e.actor,
        e.action, e.resource, e.metadata, e.created_at
      ) END AS "expectedHash",
      (h.chain_key IS NOT NULL) AS "persistedHeadPresent",
      h.last_seq AS "persistedHeadSeq",
      h.last_hash AS "persistedHeadHash"
    FROM (SELECT 1) AS scope
    LEFT JOIN audit_chain_heads h ON h.chain_key = ${organizationId}
    LEFT JOIN audit_events e ON e.organization_id = ${organizationId}
    ORDER BY e.chain_seq NULLS FIRST, e.id
  `);
  const resultRows = result.rows as Record<string, unknown>[];
  if (resultRows.length === 0 || typeof resultRows[0]?.persistedHeadPresent !== "boolean") {
    throw new Error("AUDIT_CHAIN_HEAD_EVIDENCE_UNAVAILABLE");
  }
  const first = resultRows[0];
  const persistedHead: AuditChainHead | null = first.persistedHeadPresent
    ? {
        lastSeq: Number(first.persistedHeadSeq),
        lastHash: typeof first.persistedHeadHash === "string" ? first.persistedHeadHash : "",
      }
    : null;
  const rows = resultRows.filter((row) => row.id != null).map((row) => ({
    id: Number(row.id),
    chainSeq: row.chainSeq == null ? null : Number(row.chainSeq),
    prevHash: (row.prevHash as string | null) ?? null,
    rowHash: (row.rowHash as string | null) ?? null,
    expectedHash: (row.expectedHash as string | null) ?? null,
  }));
  return evaluateAuditChain(rows, persistedHead);
}

/**
 * Manager policy exceptions are written in the same transaction as schedule
 * publication, into audit_events; the existing DB hash-chain sealer then
 * seals those immutable events. Never log only to application stdout.
 * Overlap and independently approved overtime caps cannot be waived.
 */
export function rosterRuleOverrideAuditMetadata(input: {
  managerUserId: number;
  reason: string;
  overriddenCodes: readonly string[];
}) {
  const reason = input.reason.trim();
  if (!Number.isSafeInteger(input.managerUserId) || input.managerUserId < 1
    || reason.length < 12 || reason.length > 240
    || input.overriddenCodes.length === 0
    || input.overriddenCodes.some(code =>
      !["MAX_DAILY_HOURS", "MAX_WEEKLY_HOURS", "MIN_REST_BETWEEN_SHIFTS"].includes(code))) {
    throw new Error("Roster rule override requires an authorized manager, reason, and permitted policy codes.");
  }
  return {
    managerUserId: input.managerUserId,
    overrideReason: reason,
    overriddenCodes: [...new Set(input.overriddenCodes)].sort(),
    payrollOverrides: false,
    requiresHashChainSeal: true,
  };
}

import { sql } from "drizzle-orm";
import { db } from "@/db";

export const AUDIT_CHAIN_GENESIS_HASH = "0".repeat(64);

export type AuditChainRow = {
  id: number;
  chainSeq: number | null;
  prevHash: string | null;
  rowHash: string | null;
  expectedHash: string | null;
};

export type AuditChainBreak = {
  eventId: number;
  chainSeq: number | null;
  reason: "row_altered" | "link_broken" | "sequence_gap";
};

export type AuditChainReport = {
  verified: boolean;
  chainedEvents: number;
  legacyUnchainedEvents: number;
  headSeq: number | null;
  headHash: string | null;
  breaks: AuditChainBreak[];
};

/**
 * Walks chained rows in chain_seq order. expectedHash is recomputed by the
 * database with the same audit_event_row_hash() the insert trigger used, so
 * jsonb canonicalization never has to be reproduced in TypeScript.
 */
export function evaluateAuditChain(rows: AuditChainRow[]): AuditChainReport {
  const chained = rows
    .filter((row) => row.chainSeq != null)
    .sort((left, right) => Number(left.chainSeq) - Number(right.chainSeq));
  const breaks: AuditChainBreak[] = [];

  let previousHash = AUDIT_CHAIN_GENESIS_HASH;
  let expectedSeq = 1;
  for (const row of chained) {
    if (row.chainSeq !== expectedSeq) {
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

  const head = chained.at(-1);
  return {
    verified: breaks.length === 0,
    chainedEvents: chained.length,
    legacyUnchainedEvents: rows.length - chained.length,
    headSeq: head?.chainSeq ?? null,
    headHash: head?.rowHash ?? null,
    breaks,
  };
}

export async function verifyAuditChain(organizationId: number): Promise<AuditChainReport> {
  const result = await db.execute(sql`
    SELECT
      id,
      chain_seq AS "chainSeq",
      prev_hash AS "prevHash",
      row_hash AS "rowHash",
      CASE WHEN chain_seq IS NULL THEN NULL ELSE audit_event_row_hash(
        prev_hash, chain_seq, id, organization_id, actor, action, resource, metadata, created_at
      ) END AS "expectedHash"
    FROM audit_events
    WHERE organization_id = ${organizationId}
    ORDER BY chain_seq NULLS FIRST, id
  `);
  const rows = (result.rows as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    chainSeq: row.chainSeq == null ? null : Number(row.chainSeq),
    prevHash: (row.prevHash as string | null) ?? null,
    rowHash: (row.rowHash as string | null) ?? null,
    expectedHash: (row.expectedHash as string | null) ?? null,
  }));
  return evaluateAuditChain(rows);
}

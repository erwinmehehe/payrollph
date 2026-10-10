import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pool } from "../src/db";
import { AUDIT_CHAIN_GENESIS_HASH, evaluateAuditChain, type AuditChainRow } from "../src/lib/audit-chain";

const hash = (n: number) => n.toString(16).padStart(64, "0");

function chain(length: number): AuditChainRow[] {
  return Array.from({ length }, (_, index) => ({
    id: 100 + index,
    chainSeq: index + 1,
    prevHash: index === 0 ? AUDIT_CHAIN_GENESIS_HASH : hash(index),
    rowHash: hash(index + 1),
    expectedHash: hash(index + 1),
  }));
}

test("an intact chain verifies and unsealed rows are counted as pending", () => {
  const pending: AuditChainRow = { id: 1, chainSeq: null, prevHash: null, rowHash: null, expectedHash: null };
  const report = evaluateAuditChain([pending, ...chain(3)]);
  assert.equal(report.verified, true);
  assert.equal(report.chainedEvents, 3);
  assert.equal(report.pendingSealEvents, 1);
  assert.equal(report.headSeq, 3);
  assert.equal(report.headHash, hash(3));
});

test("an edited row is detected as altered", () => {
  const rows = chain(3);
  rows[1].expectedHash = "f".repeat(64);
  const report = evaluateAuditChain(rows);
  assert.equal(report.verified, false);
  assert.deepEqual(report.breaks.map((b) => [b.eventId, b.reason]), [[101, "row_altered"]]);
});

test("a deleted middle row is detected as a gap and a broken link", () => {
  const rows = chain(4);
  rows.splice(1, 1);
  const report = evaluateAuditChain(rows);
  assert.equal(report.verified, false);
  assert.deepEqual(report.breaks.map((b) => b.reason).sort(), ["link_broken", "sequence_gap"]);
});

test("rows are evaluated in chain order, not id order", () => {
  const rows = chain(3);
  rows[0].id = 300;
  assert.equal(evaluateAuditChain([...rows].reverse()).verified, true);
});

test("0109 seals real inserts, rejects mutation and detects maintenance edits (rolled back)", async () => {
  const migration = readFileSync("drizzle/0109_tamper_evident_audit_chain.sql", "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration);
    await client.query(migration);
    const { rows: [org] } = await client.query<{ id: number }>(
      "INSERT INTO organizations (name, legal_name) VALUES ('Audit Chain QA', 'Audit Chain QA Inc.') RETURNING id",
    );
    for (const action of ["First", "Second", "Third"]) {
      await client.query(
        "INSERT INTO audit_events (organization_id, actor, action, resource, metadata) VALUES ($1, 'QA', $2, 'chain', $3)",
        [org.id, action, { action, nested: { z: 1, a: [1, 2] } }],
      );
    }

    const readChain = async () => (await client.query(`
      SELECT id, chain_seq AS "chainSeq", prev_hash AS "prevHash", row_hash AS "rowHash",
        audit_event_row_hash(prev_hash, chain_seq, id, organization_id, actor, action, resource, metadata, created_at) AS "expectedHash"
      FROM audit_events WHERE organization_id = $1`, [org.id])).rows
      .map((row) => ({ ...row, chainSeq: row.chainSeq == null ? null : Number(row.chainSeq) }));

    const beforeSeal = evaluateAuditChain(await readChain());
    assert.equal(beforeSeal.pendingSealEvents, 3, "inserts take no chain lock and wait for the sealer");

    const { rows: [seal] } = await client.query<{ sealed: number }>("SELECT seal_audit_events(100000) AS sealed");
    assert.ok(Number(seal.sealed) >= 3);
    const intact = evaluateAuditChain(await readChain());
    assert.equal(intact.verified, true);
    assert.equal(intact.chainedEvents, 3);
    assert.equal(intact.pendingSealEvents, 0);

    const orgId = Number(org.id);
    for (const statement of [
      `UPDATE audit_events SET actor = 'Eve' WHERE organization_id = ${orgId}`,
      `DELETE FROM audit_events WHERE organization_id = ${orgId}`,
      `SET LOCAL linaw.audit_sealing = 'on'; UPDATE audit_events SET row_hash = repeat('0', 64) WHERE organization_id = ${orgId}`,
    ]) {
      await client.query("SAVEPOINT attempt");
      await assert.rejects(client.query(statement), /append-only/);
      await client.query("ROLLBACK TO SAVEPOINT attempt");
    }

    await client.query("SET LOCAL linaw.audit_maintenance = 'on'");
    await client.query("UPDATE audit_events SET resource = 'edited' WHERE organization_id = $1 AND action = 'Second'", [org.id]);
    const tampered = evaluateAuditChain(await readChain());
    assert.equal(tampered.verified, false);
    assert.deepEqual(tampered.breaks.map((b) => b.reason), ["row_altered"]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

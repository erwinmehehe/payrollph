import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("statutory receipt revisions lock the parent batch and DB admits one active proof", () => {
  const api = readFileSync("src/app/api/compliance/statutory-remittances/payment-evidence/route.ts", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0136_statutory_payment_evidence_one_active.sql", "utf8");
  const http = readFileSync("scripts/qa/tenant-manifest-driven-http.mjs", "utf8");
  assert.match(api, /db\.transaction\(async \(tx\) =>/);
  assert.match(api, /from\(statutoryRemittanceBatches\)[\s\S]*?\.for\("update"\)/);
  assert.match(api, /activeRows\.length > 1/);
  assert.match(api, /const existing = await tx\.select\(\)/);
  // A committed receipt must never exist without its associated audit event.
  // Both writes must be in the same PostgreSQL transaction, not in a later call.
  const txnStart = api.indexOf("const outcome = await db.transaction(async (tx) =>");
  const auditInsert = api.indexOf("await tx.insert(auditEvents).values(");
  const txnEnd = api.indexOf("\n  });\n\n  if (outcome.kind", txnStart);
  assert.ok(txnStart >= 0 && auditInsert > txnStart && txnEnd > auditInsert,
    "Receipt insertion and audit event must commit/rollback together");
  assert.doesNotMatch(api.slice(txnEnd), /await recordAuditEvent\(/,
    "Never audit a committed receipt using a separate transaction");
  assert.match(schema, /uniqueIndex\("statutory_remittance_payment_evidence_one_active_unique"\)/);
  assert.match(schema, /where\(sql`\$\{table\.status\} = 'active'`\)/);
  assert.match(migration, /HAVING count\(\*\) > 1/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS statutory_remittance_payment_evidence_one_active_unique/);
  assert.match(migration, /WHERE status = 'active'/);
  assert.match(http, /Promise\.all\(\["race-a", "race-b", "race-c", "race-d"\]/);
  assert.match(http, /assert\.equal\(activeAfterRace\.length, 1/);
});

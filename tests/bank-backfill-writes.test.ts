import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  replaceEmployeeBankAccount, replacePayrollSnapshotBankAccount,
  type BankBackfillDatabase, type BankBackfillReplacement,
} from "../scripts/lib/bank-backfill-writes";

const input: BankBackfillReplacement = {
  id: 7, original: "  SYNTHETIC-ACCOUNT  ", encrypted: "enc:v1:synthetic-test-envelope",
};
const writers = [replaceEmployeeBankAccount, replacePayrollSnapshotBankAccount];

test("backfill compares exact source bytes using bound parameters", async () => {
  for (const writer of writers) {
    let calls = 0;
    const db: BankBackfillDatabase = {
      async query(text, values) {
        calls += 1;
        assert.deepEqual(values, [input.encrypted, input.id, input.original]);
        assert.doesNotMatch(text, /SYNTHETIC-ACCOUNT|synthetic-test-envelope/);
        assert.match(text, /WHERE id = \$2 AND/);
        assert.match(text, /= \$3/);
        assert.match(text, /RETURNING id$/);
        return { rowCount: 1 };
      },
    };
    await writer(db, input);
    assert.equal(calls, 1);
  }
});

test("backfill refuses missing, stale, ambiguous and duplicate write results", async () => {
  for (const writer of writers) {
    for (const rowCount of [0, null, 2]) {
      let calls = 0;
      await assert.rejects(writer({ async query() { calls += 1; return { rowCount }; } }, input),
        /changed during backfill; repeat dry-run/);
      assert.equal(calls, 1, "never retry a stale account automatically");
    }
  }
});

test("invalid bank backfill inputs never reach the database", async () => {
  for (const writer of writers) {
    for (const replacement of [
      { ...input, id: 0 }, { ...input, id: -1 }, { ...input, id: 1.5 },
      { ...input, id: Number.MAX_SAFE_INTEGER + 1 },
      { ...input, original: "" }, { ...input, original: "  " },
      { ...input, encrypted: "plaintext" }, { ...input, encrypted: "enc:v1:" },
      { ...input, original: input.encrypted },
    ]) {
      await assert.rejects(writer({ async query() { assert.fail("must not query"); } }, replacement),
        /Invalid bank backfill replacement/);
    }
  }
});

test("snapshot update patches only the bank leaf on the latest stored trace", async () => {
  await replacePayrollSnapshotBankAccount({
    async query(text) {
      assert.ok(text.includes("jsonb_set(trace, '{payment,bankAccount}', to_jsonb($1::text), false)"));
      assert.ok(text.includes("trace #>> '{payment,bankAccount}' = $3"));
      assert.ok(text.includes("jsonb_typeof(trace #> '{payment,bankAccount}') = 'string'"));
      assert.doesNotMatch(text, /SET trace = \$\d/);
      return { rowCount: 1 };
    },
  }, input);
});

test("script uses guarded writes only after encryption and round-trip validation", () => {
  const source = readFileSync("scripts/encrypt-bank-accounts.ts", "utf8");
  assert.match(source, /replaceEmployeeBankAccount\(pool, \{\s*id: row\.id, original: row\.bankAccount!, encrypted: sealed/);
  assert.match(source, /replacePayrollSnapshotBankAccount\(pool, \{\s*id: row\.id, original: trace\.payment!\.bankAccount!, encrypted: sealed/);
  assert.ok(source.indexOf("if (!apply)") < source.indexOf("await replaceEmployeeBankAccount"));
  assert.ok(source.indexOf("decryptBankAccount(sealed) !== plain") < source.indexOf("await replaceEmployeeBankAccount"));
  assert.doesNotMatch(source, /db\.update\(employees\)|\.update\(payrollEntries\)|trace: \{ \.\.\.trace/);
  assert.match(source, /eq\(legalEntities.disbursementAccount, row.bankAccount!\)/);
  assert.match(source, /eq\(employeePayoutChangeRequests.proposedBankAccount, row.bankAccount!\)/);
});

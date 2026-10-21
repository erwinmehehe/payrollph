import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { mock } from "node:test";
const require = createRequire(import.meta.url);
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
const { db } = require("../src/db") as typeof import("../src/db");
const { recordSuccessfulLocalLogin } = require("../src/lib/audit") as typeof import("../src/lib/audit");

test("login auditing is exact-true opt-in, sanitized and fails closed on write failure", async () => {
  const previous = process.env.LOCAL_LOGIN_AUDIT_ENABLED;
  const input = { userId: 42, actor: "Fictional owner", mfaVerified: false };
  let calls = 0;
  let written: unknown;
  let fail = false;
  const tx = {
    select: () => ({ from: () => ({ where: async () => [{ organizationId: 7 }, { organizationId: 9 }] }) }),
    insert: () => ({ values: async (value: unknown) => { written = value; if (fail) throw new Error("audit write rejected"); } }),
  };
  const mocked = mock.method(db, "transaction", async (callback: (value: unknown) => Promise<number>) => {
    calls++; return callback(tx);
  });
  try {
    for (const flag of [undefined, "false", "TRUE", "1", ""]) {
      if (flag === undefined) delete process.env.LOCAL_LOGIN_AUDIT_ENABLED;
      else process.env.LOCAL_LOGIN_AUDIT_ENABLED = flag;
      assert.equal(await recordSuccessfulLocalLogin(input), 0);
    }
    assert.equal(calls, 0, "flag off never opens a transaction or writes audit rows");
    process.env.LOCAL_LOGIN_AUDIT_ENABLED = "true";
    assert.equal(await recordSuccessfulLocalLogin(input), 2);
    assert.deepEqual(written, [7, 9].map(organizationId => ({ organizationId,
      actor: input.actor, action: "Successful local password sign-in", resource: "Account authentication",
      metadata: { userId: 42, authMethod: "local", mfaVerified: false },
    })));
    fail = true;
    await assert.rejects(recordSuccessfulLocalLogin(input), /audit write rejected/);
  } finally {
    mocked.mock.restore();
    if (previous === undefined) delete process.env.LOCAL_LOGIN_AUDIT_ENABLED;
    else process.env.LOCAL_LOGIN_AUDIT_ENABLED = previous;
  }
});

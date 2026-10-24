import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  bankFileValidations, organizations, payrollRuns, users, userOrganizations,
} from "../src/db/schema";
import {
  getBankFileValidation, listBankFileValidations,
  recordBankPortalOutcome, regenerateRecordedBankFile,
} from "../src/lib/bank-evidence-store";

// Two fictional employers, a deliberately mismatched run FK, and no real bank
// files, provider calls, production DB, payout, or payroll release action.
const disposable = (() => {
  const raw = process.env.DATABASE_URL;
  if (process.env.CI !== "true" || !raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "postgresql:" && url.hostname === "127.0.0.1"
      && url.port === "5432" && url.pathname === "/app_db"
      && url.username === "postgres" && url.password === "postgres"
      && !url.search && !url.hash;
  } catch {
    return false;
  }
})();

const require = createRequire(import.meta.url);
const target = (name: string, orgId: number) =>
  new Request(`http://127.0.0.1:3000/api/compliance/bank-validations${name}?organizationId=${orgId}`);
const bodyFor = (organizationId: number) => ({
  organizationId,
  outcome: "rejected",
  note: "Fictional rejection in an isolated database; no bank portal contacted",
  submittedAt: "2026-10-24T09:00:00.000Z",
});

test("bank validation evidence is tenant-isolated for read, file, mutation, and source-run mismatches", {
  skip: !disposable, timeout: 60_000,
}, async () => {
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");

  const suffix = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Fictional Bank Isolation Alpha " + suffix, legalName: "Fictional Alpha " + suffix },
    { name: "Fictional Bank Isolation Beta " + suffix, legalName: "Fictional Beta " + suffix },
  ]).returning();
  let userIds: number[] = [];
  try {
    const [runA, runB] = await db.insert(payrollRuns).values([
      { organizationId: alpha.id, periodLabel: "FICTIONAL ALPHA - no payout",
        periodStart: "2026-10-01", periodEnd: "2026-10-15",
        payDate: "2026-10-20", status: "Released" },
      { organizationId: beta.id, periodLabel: "FICTIONAL BETA - no payout",
        periodStart: "2026-10-01", periodEnd: "2026-10-15",
        payDate: "2026-10-20", status: "Released" },
    ]).returning();
    const evidence = (organizationId: number, payrollRunId: number | null, tag: string) => ({
      organizationId, payrollRunId,
      templateName: "FICTIONAL_NO_UPLOAD_" + suffix,
      templateVersion: "v0",
      fileName: "fictional-" + tag + ".txt",
      fileSha256: tag.charCodeAt(0).toString(16).padStart(2, "0").repeat(32),
      generatedBy: "ISOLATED-TEST-" + tag,
    });
    const [own, victim, archived] = await db.insert(bankFileValidations).values([
      evidence(alpha.id, runA.id, "A"),
      evidence(beta.id, runB.id, "B"),
      evidence(alpha.id, null, "C"),
    ]).returning();
    assert.deepEqual((await listBankFileValidations(alpha.id)).map(row => row.id).sort((a, b) => a - b),
      [own.id, archived.id].sort((a, b) => a - b));
    assert.deepEqual((await listBankFileValidations(beta.id)).map(row => row.id), [victim.id]);
    assert.equal(await getBankFileValidation(alpha.id, victim.id), null);
    assert.equal(await getBankFileValidation(beta.id, own.id), null);
    assert.equal((await getBankFileValidation(alpha.id, own.id))?.id, own.id);
    assert.equal((await getBankFileValidation(alpha.id, archived.id))?.id, archived.id);

    const rejected = {
      outcome: "rejected" as const, portalReference: null,
      submittedAt: new Date("2026-10-24T09:00:00.000Z"),
      note: "Fictional rejection; no provider or money movement",
    };
    assert.equal(await recordBankPortalOutcome({
      organizationId: alpha.id, id: victim.id, actor: "Synthetic A", outcome: rejected,
    }), null, "guessed victim ID must not update another employer's evidence");
    assert.equal(await recordBankPortalOutcome({
      organizationId: alpha.id, id: archived.id, actor: "Synthetic A", outcome: rejected,
    }), null, "orphan evidence must never be accepted as current bank UAT");
    const afterOwn = await recordBankPortalOutcome({
      organizationId: alpha.id, id: own.id, actor: "Synthetic A", outcome: rejected,
    });
    assert.equal(afterOwn?.status, "rejected", "owned source remains updateable by the service");
    assert.equal(await recordBankPortalOutcome({
      organizationId: alpha.id, id: own.id, actor: "Synthetic A", outcome: rejected,
    }), null, "a resolved outcome is immutable");

    // The existing schema allows an inconsistent historical FK: a bank
    // validation labeled Alpha while pointing at a Beta payroll run. It must
    // never appear in Alpha's list, file download or accepted-UAT path.
    let malformed: typeof own | null = null;
    try {
      [malformed] = await db.insert(bankFileValidations)
        .values(evidence(alpha.id, runB.id, "D")).returning();
    } catch (error) {
      assert.match(String(error), /foreign key|constraint|tenant|violates/i,
        "only a DB-level ownership constraint may reject the synthetic mismatch");
    }
    if (malformed) {
      assert.equal(await getBankFileValidation(alpha.id, malformed.id), null);
      assert.equal((await listBankFileValidations(alpha.id)).some(row => row.id === malformed!.id), false);
      assert.equal(await recordBankPortalOutcome({
        organizationId: alpha.id, id: malformed.id, actor: "Synthetic A", outcome: rejected,
      }), null);
      await assert.rejects(() => regenerateRecordedBankFile(malformed!),
        /Bank validation source no longer belongs to this workspace/);
      const [badAfter] = await db.select().from(bankFileValidations).where(eq(bankFileValidations.id, malformed.id));
      assert.equal(badAfter.status, "generated", "mismatched evidence remains unapproved");
    }
    assert.equal((await getBankFileValidation(beta.id, victim.id))?.status, "generated");

    const people = await db.insert(users).values([
      { email: `bank-iso-a-${randomUUID()}@example.test`, name: "Synthetic Owner A",
        passwordHash: "not-a-real-login", role: "owner" },
      { email: `bank-iso-b-${randomUUID()}@example.test`, name: "Synthetic Owner B",
        passwordHash: "not-a-real-login", role: "owner" },
    ]).returning();
    userIds = people.map(person => person.id);
    await db.insert(userOrganizations).values([
      { organizationId: alpha.id, userId: people[0].id, role: "owner", active: true },
      { organizationId: beta.id, userId: people[1].id, role: "owner", active: true },
    ]);

    // Mock ONLY the framework session adapter. Role gates, tenant predicates,
    // permission overlay, and real isolated PostgreSQL remain unmocked.
    const authPath = require.resolve("../src/lib/auth");
    const authModule = require(authPath);
    const cache = require.cache[authPath]!;
    const originalExports = cache.exports;
    const session = (person: typeof people[number]) => ({
      ...person, totpEnabled: true, mfaVerifiedAt: new Date(), authMethod: "oidc",
    });
    let caller: ReturnType<typeof session> | null = null;
    cache.exports = { ...authModule, getSessionUser: async () => caller };
    const originalOrigins = process.env.TRUSTED_APP_ORIGINS;
    process.env.TRUSTED_APP_ORIGINS = "http://127.0.0.1:3000";
    try {
      const { GET: listGet } = await import("../src/app/api/compliance/bank-validations/route");
      const { GET: fileGet } = await import("../src/app/api/compliance/bank-validations/[id]/file/route");
      const { PATCH: outcomePatch } = await import("../src/app/api/compliance/bank-validations/[id]/route");
      const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
      const patch = (id: number, org: number) => new Request(
        `http://127.0.0.1:3000/api/compliance/bank-validations/${id}`, {
          method: "PATCH",
          headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin",
            "content-type": "application/json" },
          body: JSON.stringify(bodyFor(org)),
        },
      );

      assert.equal((await listGet(target("", alpha.id))).status, 401);
      caller = session(people[0]);
      const ownResponse = await listGet(target("", alpha.id));
      assert.equal(ownResponse.status, 200);
      const ownList = await ownResponse.json() as { records: Array<{ id: number }> };
      assert.ok(ownList.records.some(record => record.id === own.id));
      assert.ok(ownList.records.some(record => record.id === archived.id));
      assert.ok(!ownList.records.some(record => record.id === victim.id || record.id === malformed?.id));

      const otherList = await listGet(target("", beta.id));
      assert.equal(otherList.status, 403);
      assert.doesNotMatch(await otherList.text(), /ISOLATED-TEST-B|fictional-B|BANK_ACCOUNT/i);

      // Attackers try a genuine victim primary key with their owned employer
      // selector, followed by a forged foreign employer selector.
      assert.equal((await fileGet(target(`/${victim.id}/file`, alpha.id), params(victim.id))).status, 404);
      assert.equal((await fileGet(target(`/${victim.id}/file`, beta.id), params(victim.id))).status, 403);
      if (malformed) {
        assert.equal((await fileGet(target(`/${malformed.id}/file`, alpha.id), params(malformed.id))).status, 404);
      }
      assert.equal((await outcomePatch(patch(victim.id, alpha.id), params(victim.id))).status, 404);
      assert.equal((await outcomePatch(patch(victim.id, beta.id), params(victim.id))).status, 403);
      const [victimAfterAttack] = await db.select().from(bankFileValidations)
        .where(eq(bankFileValidations.id, victim.id));
      assert.deepEqual(victimAfterAttack, victim,
        "denied file/PATCH/GET attempts may not change another tenant's evidence");

      caller = session(people[1]);
      const betaResponse = await listGet(target("", beta.id));
      assert.equal(betaResponse.status, 200);
      assert.deepEqual((await betaResponse.json() as { records: Array<{ id: number }> }).records
        .map(record => record.id), [victim.id]);
      assert.equal((await listGet(target("", alpha.id))).status, 403);
      assert.equal((await outcomePatch(patch(own.id, beta.id), params(own.id))).status, 404);
    } finally {
      cache.exports = originalExports;
      if (originalOrigins === undefined) delete process.env.TRUSTED_APP_ORIGINS;
      else process.env.TRUSTED_APP_ORIGINS = originalOrigins;
    }

    const [victimFinal] = await db.select().from(bankFileValidations)
      .where(eq(bankFileValidations.id, victim.id));
    assert.deepEqual(victimFinal, victim, "both tenant identities leave victim records unchanged");
  } finally {
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  }
});

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, userOrganizations, users, yearEndPriorEvidence } from "../src/db/schema";
import { assertFinalPayPriorSnapshot, loadReviewedPriorForFinalPay } from "../src/lib/final-pay-prior-employer-server";
import { priorIntake } from "../src/lib/year-end-prior-evidence-server";

/**
 * Only run with CI's explicitly disposable PG16 or PG18. Never write to Neon or
 * employer data. One real maker, separate checker, and real encrypted evidence.
 */
const isolated = (() => {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") return false;
  const uri = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
  assert.equal(uri.protocol, "postgresql:");
  assert.equal(uri.hostname, "127.0.0.1");
  assert.equal(uri.port, "5432");
  assert.equal(uri.pathname, "/app_db");
  assert.equal(uri.username, "postgres");
  return true;
})();

test("Disposable PG: approved prior-2316 source is required and fingerprint-checked at all separation finance gates", { skip: !isolated }, async () => {
  const previous = process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
  const oldPii = process.env.PII_ENCRYPTION_KEY;
  const suffix = randomBytes(6).toString("hex");
  process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED = "true";
  if (!oldPii) process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("hex");

  const [org, foreign] = await db.insert(organizations).values([
    { name: "FICTIONAL final prior " + suffix, legalName: "Fictional Prior Inc", plan: "Core" },
    { name: "FICTIONAL foreign prior " + suffix, legalName: "Fictional Foreign Inc", plan: "Core" },
  ]).returning();
  const userIds: number[] = [];
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "FPPR-" + suffix, firstName: "Fictional",
      lastName: "Worker", title: "QA", avatarInitials: "FW", basicRate: "30000.00",
      startDate: "2026-07-01", region: "NCR", mwe: false,
    }).returning();
    const actors = await db.insert(users).values(["maker", "checker", "viewer", "foreign"].map(role => ({
      name: "Fictional " + role, email: "fppr-" + role + "-" + suffix + "@example.invalid", passwordHash: "never-login",
    }))).returning();
    userIds.push(...actors.map(actor => actor.id));
    await db.insert(userOrganizations).values([
      ...actors.slice(0, 3).map(actor => ({
        userId: actor.id, organizationId: org.id, role: "owner", active: true,
      })),
      { userId: actors[3].id, organizationId: foreign.id, role: "owner", active: true },
    ]);
    const scope = { organizationId: org.id, employeeId: worker.id, taxYear: 2026 };
    const access = { ...scope, actorUserId: actors[2].id };
    const read = () => db.transaction(tx => loadReviewedPriorForFinalPay(access, tx));

    await assert.rejects(read(), /FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_REQUIRED/,
      "missing prior history cannot be assumed zero when flag ON");

    const evidence = {
      status: "verified", employerName: "Fictional Previous Employer", employerTin: "123456789-0000",
      periodFrom: "2026-01-01", periodTo: "2026-06-30",
      taxableIncome: "165000.00", taxWithheld: "1500.00", exemptBenefits: "0.00",
      sourceReference: "SYNTHETIC-2316-" + suffix, sourceSha256: "a".repeat(64),
      peraCredit: "0.00", peraReference: "", peraSha256: "",
    };
    const maker = { id: actors[0].id, name: actors[0].name };
    const checker = { id: actors[1].id, name: actors[1].name };
    await priorIntake(scope, maker, { action: "save", evidence, expectedDigest: "" });
    await assert.rejects(read(), /FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_REQUIRED/,
      "unapproved prior history cannot alter final-pay tax");
    const stored = await priorIntake(scope, maker) as { digest: string };
    await assert.rejects(priorIntake(scope, maker, { action: "approve", expectedDigest: stored.digest }),
      /PRIOR_INDEPENDENT_CHECKER_REQUIRED/, "maker cannot approve own prior employer evidence");
    await priorIntake(scope, checker, { action: "approve", expectedDigest: stored.digest });
    const reviewed = await read();
    assert.ok(reviewed);
    assert.equal(reviewed.evidence.status, "verified");
    assert.equal(reviewed.evidence.taxableIncome, "165000.00");
    assert.equal(reviewed.evidence.taxWithheld, "1500.00");
    assert.equal(reviewed.snapshot.digest, stored.digest);

    // No raw prior-employer amount is copied into the separation fingerprint.
    assert.deepEqual(Object.keys(reviewed.snapshot).sort(),
      ["digest", "revision", "status", "taxYear"]);
    assert.equal(JSON.stringify(reviewed.snapshot).includes("165000"), false);

    await db.transaction(tx => assertFinalPayPriorSnapshot(access, reviewed.snapshot, tx));
    await assert.rejects(db.transaction(tx => loadReviewedPriorForFinalPay({
      ...scope, actorUserId: actors[3].id,
    }, tx)), /FINAL_PAY_PRIOR_EMPLOYER_ENTITY_ACCESS_DENIED/,
    "a user of another employer cannot decrypt or reuse this record");

    const [row] = await db.select().from(yearEndPriorEvidence)
      .where(eq(yearEndPriorEvidence.organizationId, org.id));
    assert.ok(row);
    await db.update(yearEndPriorEvidence).set({ revision: row.revision + 1 })
      .where(eq(yearEndPriorEvidence.id, row.id));
    await assert.rejects(db.transaction(tx => assertFinalPayPriorSnapshot(access, reviewed.snapshot, tx)),
      /FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_CHANGED/,
      "revised prior-evidence source must invalidate prepared package");

    // Disable only inside this disposable process: old flag-OFF behavior performs no
    // evidence read; a package created when flag was ON can no longer release.
    delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
    assert.equal(await read(), null, "flag OFF must not consult stored prior figures");
    await db.transaction(tx => assertFinalPayPriorSnapshot(access, undefined, tx));
    await assert.rejects(db.transaction(tx => assertFinalPayPriorSnapshot(access, reviewed.snapshot, tx)),
      /FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_CHANGED/, "disabling prior mode cannot release a prior-mode package");
  } finally {
    await db.delete(yearEndPriorEvidence).where(eq(yearEndPriorEvidence.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(organizations).where(eq(organizations.id, foreign.id));
    for (const userId of userIds) {
      await db.delete(userOrganizations).where(eq(userOrganizations.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    if (previous === undefined) delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
    else process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED = previous;
    if (oldPii === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = oldPii;
  }
});

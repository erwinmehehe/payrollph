/** Real HTTP/PG bank evidence controls. Fictional files only; no portal/provider call. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, bankFileValidations, bankTemplates, employees, payrollEntries,
  payrollRuns, sessions, userOrganizations, users } from "../../src/db/schema";
import { encryptBankAccount } from "../../src/lib/bank-account-crypto";

export async function verifyBankTenantIsolation(f, { request, expectStatus, makeSession }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  const target = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.port, "5432");
  assert.equal(target.pathname, "/app_db");
  const nonce = randomUUID().slice(0, 12);
  // Deliberately fictional, uniquely named adapter. This does not certify any bank format.
  const [template] = await db.insert(bankTemplates).values({
    name: "CI FICTIONAL " + nonce, version: "ci-only", format: "CSV",
    mappings: { columns: ["employee_no", "account_number", "net_pay"], includeHeader: true },
  }).returning();
  const fixtures = [];
  for (const [idx, org] of f.orgs.entries()) {
    const account = "987654" + String(idx).padStart(6, "0");
    const encrypted = encryptBankAccount(account);
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "CI-BANK-" + nonce + "-" + idx,
      firstName: "FictionalBank", lastName: "Worker" + idx,
      legalEntityId: f.entities[idx].id, title: "Fictional worker", avatarInitials: "FW",
      basicRate: "10000.00", startDate: "2026-10-01",
      bankAccount: encrypted, bankCode: "CI", status: "Active",
    }).returning();
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, legalEntityId: f.entities[idx].id,
      periodLabel: "CI-BANK-ONLY-" + nonce + "-" + idx,
      periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-20",
      status: "Released", employeeCount: 1, grossPay: "5000.00", netPay: "5000.00",
    }).returning();
    await db.insert(payrollEntries).values({ payrollRunId: run.id, employeeId: worker.id,
      grossPay: "5000.00", deductions: "0.00", netPay: "5000.00",
      trace: { payment: { employeeName: "FictionalBank Worker" + idx,
        employeeNo: worker.employeeNo, bankAccount: encrypted, bankCode: "CI", mobile: null } },
    });
    await db.update(users).set({ totpEnabled: true }).where(eq(users.id, f.owners[idx].id)); await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, f.ownerSessions[idx].id));
    const created = expectStatus(await request("/api/compliance/bank-validations", {
      method: "POST", cookie: f.ownerSessions[idx].cookie,
      body: { organizationId: org.id, runId: run.id, templateName: template.name },
    }), 201, "Owner creates real generated bank evidence");
    assert.equal(created.json?.record?.organizationId, org.id);
    assert.equal(created.json?.record?.payrollRunId, run.id);
    assert.match(created.json?.record?.fileSha256 ?? "", /^[a-f0-9]{64}$/);
    fixtures.push({ worker, run, account, record: created.json.record });
  }
  const victim = fixtures[0];
  async function snapshot() {
    return {
      records: await db.select().from(bankFileValidations).where(eq(bankFileValidations.organizationId, f.orgs[0].id)).orderBy(bankFileValidations.id),
      audit: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, f.orgs[0].id)).orderBy(auditEvents.id),
      entries: await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, victim.run.id)),
      worker: await db.select().from(employees).where(eq(employees.id, victim.worker.id)),
    };
  }
  const before = await snapshot();
  for (const idx of [1, 2]) {
    const own = fixtures[idx];
    const org = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    const ownList = expectStatus(await request("/api/compliance/bank-validations?organizationId=" + org.id, { cookie }), 200, "Own stored records readable");
    assert.ok(ownList.json.records.some(r => r.id === own.record.id));
    assert.ok(ownList.json.records.every(r => r.organizationId === org.id));
    expectStatus(await request("/api/compliance/bank-validations?organizationId=" + f.orgs[0].id, { cookie }), 403, "Foreign bank evidence list denied");
    const ownFile = expectStatus(await request("/api/compliance/bank-validations/" + own.record.id + "/file?organizationId=" + org.id, { cookie }), 200, "Actual own bank CSV downloadable");
    assert.ok(ownFile.text.includes(own.account) && ownFile.text.includes(own.worker.employeeNo));
    assert.equal(createHash("sha256").update(ownFile.text).digest("hex"), own.record.fileSha256);
    assert.equal(ownFile.headers.get("x-linaw-file-sha256"), own.record.fileSha256);
    assert.match(ownFile.headers.get("cache-control"), /no-store/);
    for (const [organizationId, status] of [[f.orgs[0].id, 403], [org.id, 404]]) {
      const denied = expectStatus(await request("/api/compliance/bank-validations/" + victim.record.id + "/file?organizationId=" + organizationId, { cookie }), status, "Victim bank bytes inaccessible with either employer selector");
      assert.ok(!denied.text.includes(victim.account) && !denied.text.includes(victim.worker.employeeNo));
      assert.match(denied.headers.get("content-type"), /json/);
      expectStatus(await request("/api/compliance/bank-validations", { method: "POST", cookie,
        body: { organizationId, runId: victim.run.id, templateName: template.name },
      }), status, "Cannot generate evidence for victim payroll");
      expectStatus(await request("/api/compliance/bank-validations/" + victim.record.id, { method: "PATCH", cookie,
        body: { organizationId, outcome: "accepted", portalReference: "FORGED-CI-ONLY" },
      }), status, "Cannot accept victim bank evidence");
    }
    const ownPatch = expectStatus(await request("/api/compliance/bank-validations/" + own.record.id, { method: "PATCH", cookie,
      body: { organizationId: org.id, outcome: "rejected", note: "Fictional rejection; no bank portal contacted" },
    }), 200, "Owner records synthetic rejection on own evidence");
    assert.equal(ownPatch.json.record.status, "rejected");
    expectStatus(await request("/api/compliance/bank-validations/" + own.record.id, { method: "PATCH", cookie,
      body: { organizationId: org.id, outcome: "accepted", portalReference: "CI-ONLY" },
    }), 409, "Outcome immutable after first resolution");
    const [lowRole] = await db.insert(users).values({ email: "bank-role-" + nonce + idx + "@example.invalid",
      name: "Fictional employee", passwordHash: "unused-fixture", role: "employee", employeeId: own.worker.id }).returning();
    await db.insert(userOrganizations).values({ userId: lowRole.id, organizationId: org.id, role: "employee", active: true });
    const lowCookie = (await makeSession(lowRole.id)).cookie;
    for (const roleCookie of [lowCookie, null]) {
      const status = roleCookie ? 403 : 401;
      expectStatus(await request("/api/compliance/bank-validations?organizationId=" + org.id, { cookie: roleCookie }), status, "List requires payroll role");
      expectStatus(await request("/api/compliance/bank-validations/" + own.record.id + "/file?organizationId=" + org.id, { cookie: roleCookie }), status, "File requires payroll role");
      expectStatus(await request("/api/compliance/bank-validations", { method: "POST", cookie: roleCookie, body: { organizationId: org.id, runId: own.run.id, templateName: template.name } }), status, "Generation requires payroll role");
      expectStatus(await request("/api/compliance/bank-validations/" + own.record.id, { method: "PATCH", cookie: roleCookie, body: { organizationId: org.id, outcome: "accepted", portalReference: "CI-ONLY" } }), status, "Outcome requires owner role");
    }
    // A previously authorized reader loses the old employer grant but stays signed in.
    const [formerOwner] = await db.insert(users).values({ email: "bank-revoke-" + nonce + idx + "@example.invalid",
      name: "Fictional former owner", passwordHash: "unused-fixture", role: "owner", totpEnabled: true }).returning();
    await db.insert(userOrganizations).values([org.id, f.orgs[idx === 1 ? 2 : 1].id].map(organizationId => ({
      userId: formerOwner.id, organizationId, role: "owner", active: true,
    })));
    const formerSession = await makeSession(formerOwner.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, formerSession.id));
    expectStatus(await request("/api/compliance/bank-validations/" + own.record.id + "/file?organizationId=" + org.id, { cookie: formerSession.cookie }), 200, "Former owner really could read the same file");
    await db.update(userOrganizations).set({ active: false }).where(and(eq(userOrganizations.userId, formerOwner.id), eq(userOrganizations.organizationId, org.id)));
    expectStatus(await request("/api/account", { cookie: formerSession.cookie }), 200, "Former owner still authenticated");
    expectStatus(await request("/api/compliance/bank-validations/" + own.record.id + "/file?organizationId=" + org.id, { cookie: formerSession.cookie }), 403, "Revoked owner cannot download previously readable bank data");
  }
  const after = await snapshot();
  assert.deepEqual(after, before, "All victim bank evidence, audit, wages and destinations unchanged");
  console.log(JSON.stringify({ result: "PASS", kind: "BANK_TENANT_REAL_HTTP_PG", methods: 4,
    attackerEmployers: 2, ownFileHashesVerified: 2, providerCalls: 0, bankFormatCertified: false }));
}

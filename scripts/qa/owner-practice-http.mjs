/** Executed only from the guarded disposable-PG/localhost security harness. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { payrollRuns, employees } from "../../src/db/schema";

export async function verifyOwnerPracticeHttp(f, { request, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  async function snapshot() {
    return Promise.all(f.orgs.map(async org => ({
      runs: await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, org.id)).orderBy(payrollRuns.id),
      workers: await db.select().from(employees).where(eq(employees.organizationId, org.id)).orderBy(employees.id),
    })));
  }
  const before = await snapshot();
  for (const idx of [1, 2]) {
    const own = expectStatus(await request("/api/dashboard?organizationId=" + f.orgs[idx].id, { cookie: f.ownerSessions[idx].cookie }), 200, "Actual owner can load fictional practice inputs");
    assert.equal(own.json.practicePayroll?.status, "ready");
    assert.equal(own.json.practicePayroll.scenarios[0].workers[0].grossCents, 1500000);
    assert.ok(own.json.practicePayroll.scenarios.every(s => s.workers.every(w => w.name.startsWith("Fictional ") && !Object.hasOwn(w, "bankAccount"))));
    expectStatus(await request("/api/dashboard?organizationId=" + f.orgs[0].id, { cookie: f.ownerSessions[idx].cookie }), 403, "Practice cannot bypass dashboard employer authorization");
  }
  expectStatus(await request("/api/dashboard?organizationId=" + f.orgs[0].id), 401, "Anonymous callers cannot use owner dashboard");
  assert.deepEqual(await snapshot(), before, "Practice reads never insert a payroll run or alter any employer worker");
  console.log(JSON.stringify({ result: "PASS", kind: "OWNER_PRACTICE_READ_ONLY_HTTP", ownerEmployers: 2, liveWrites: 0, bankDataIncluded: false }));
}

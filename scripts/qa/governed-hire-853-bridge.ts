/**
 * #853 P0 additive synthetic governed-Hire proof.
 * Runs AFTER the existing nine-stage payroll and mobile test, in the SAME
 * disposable localhost PostgreSQL fixture, but uses a SEPARATE future-start
 * fictional candidate. It must NEVER be described as the nine-stage payroll
 * worker's source lineage, human acceptance, or a payout/filing test.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { hashPassword } from "../../src/lib/crypto";
import {
  employees, employeePayProfiles, hcmBusinessProcessDefinitions,
  hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps,
  jobApplicants, jobProfiles, jobRequisitions, organizations,
  payrollEntries, payrollRuns, positionAssignments, positions,
  provisioningTasks, userOrganizations, users, workerEmploymentEvents,
} from "../../src/db/schema";

const BASE = "http://127.0.0.1:3000";
const reportPath = "qa-artifacts/governed-hire-853-report.json";
const report = {
  schemaVersion: 1,
  sourceSha: process.env.PR_HEAD_SHA ?? "unknown",
  scope: "isolated-fictional-hire-sidecar-not-the-connected-payroll-worker",
  status: "NOT_RUN",
  independentHumanUat: "NOT_RUN",
  externalEmployerPilot: "NO_GO",
  payoutOrAgencySubmission: "PROHIBITED",
  steps: [] as string[],
  checks: [] as string[],
};
function save() { writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); }
const { fixtureClockOffset } = createRequire(import.meta.url)("./synthetic-session-clock.cjs");
const { boundedSyntheticLoginWaitMs } = createRequire(import.meta.url)("./governed-hire-auth-backoff.cjs");
function safeEnvironment() {
  // performance uses the real host clock even under the guarded Date preload.
  fixtureClockOffset(process.env, Math.trunc(performance.timeOrigin + performance.now()));
  assert.match(process.env.PR_HEAD_SHA ?? "", /^[0-9a-f]{40}$/);
}

class Client {
  cookie = "";
  async json(path: string, method = "GET", payload?: unknown) {
    const headers = new Headers();
    if (this.cookie) headers.set("cookie", this.cookie);
    if (method !== "GET") {
      headers.set("origin", BASE);
      headers.set("content-type", "application/json");
    }
    const response = await fetch(BASE + path, {
      method, headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
  }
  async ok(path: string, method = "GET", payload?: unknown) {
    const response = await this.json(path, method, payload);
    assert.ok(response.status >= 200 && response.status < 300,
      method + " " + path.split("?")[0] + " status=" + response.status
      + " code=" + String(response.body.code ?? "unknown"));
    return response.body;
  }
}
async function login(email: string, password: string) {
  const client = new Client();
  let result = await client.json("/api/auth/login", "POST", { email, password });
  if (result.status === 429) {
    // The prior nine-stage and mobile tests share localhost IP rate limits.
    // Wait for the *actual* limiter window once; never reset/disable it.
    const wait = boundedSyntheticLoginWaitMs(result.status, result.body);
    await new Promise<void>((resolve) => setTimeout(resolve, wait));
    result = await client.json("/api/auth/login", "POST", { email, password });
  }
  assert.ok(result.status >= 200 && result.status < 300,
    "POST /api/auth/login status=" + result.status +
      " code=" + String(result.body.code ?? "unknown"));
  assert.equal(result.body.user?.email, email);
  assert.ok(client.cookie, "Missing isolated browser-session login cookie");
  return client;
}
async function main() {
  safeEnvironment();
  // Independent fixture actors; no browser credential file is read or sent.
  const password = "FictionalGovernedOnly!" + randomUUID();
  const startDate = new Date(Date.parse(
    process.env.NINE_STAGE_SYNTHETIC_CLOCK + "T00:00:00.000Z") + 86400000,
  ).toISOString().slice(0, 10);
  const companyRows = await db.select({
    id: organizations.id, name: organizations.name,
  }).from(organizations);
  assert.equal(companyRows.length, 2, "Must be the exact two fictional nine-stage employers");
  // The private-invite signup preserves the company name with "Inc.", while
  // the legacy governed fixture uses the shorter name. Both are fictional
  // and exact-matched; never select a tenant by list order or prefix.
  const alpha = companyRows.find(r =>
    r.name === "Fictional Connected Employer A" ||
    r.name === "Fictional Connected Employer A Inc."
  )?.id;
  const beta = companyRows.find(r => r.name === "Fictional Connected Employer B")?.id;
  assert.ok(alpha && beta && alpha !== beta);
  const [released] = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, alpha), eq(payrollRuns.status, "Released"),
  )).limit(1);
  assert.ok(released, "The connected payroll test must have released records first");
  const releasedEntriesBefore = await db.select().from(payrollEntries).where(eq(
    payrollEntries.payrollRunId, released.id,
  ));
  assert.equal(releasedEntriesBefore.length, 1,
    "Governed hire sidecar runs only after single-worker payroll capture");

  const [creatorUser] = await db.insert(users).values({
    email: "hiring.nine@linaw.test", name: "Fictional Hiring Initiator",
    role: "hr", passwordHash: hashPassword(password),
    backupCodes: [], totpEnabled: false,
  }).returning();
  await db.insert(userOrganizations).values({
    organizationId: alpha, userId: creatorUser.id, role: "hr",
  });

  // Approved job architecture and Hire policy are synthetic fixture setup only;
  // the public recruitment, review and conversion APIs perform the real changes.
  const [profile] = await db.insert(jobProfiles).values({
    organizationId: alpha, title: "Fictional Governed Hire Role", active: true,
  }).returning();
  const [position] = await db.insert(positions).values({
    organizationId: alpha, code: "NINE-GOV-HIRE-02", jobProfileId: profile.id,
    annualBudget: "480000.00", status: "approved",
  }).returning();
  await db.insert(hcmBusinessProcessDefinitions).values({
    organizationId: alpha, code: "nine-governed-hire-review",
    name: "Fictional independent hire review", processType: "hire",
    effectiveFrom: "2026-01-01", active: true, version: 1,
    steps: [
      { type: "approval", label: "Independent HR review", assignee: "role:hr", dueDays: 2, priority: "High" },
      { type: "approval", label: "Owner decision", assignee: "role:owner", dueDays: 2, priority: "High" },
    ],
  });

  const actorDefinitions = [
    { email: "governed.owner.nine@linaw.test", role: "owner", organizationId: alpha },
    { email: "governed.hr.nine@linaw.test", role: "hr", organizationId: alpha },
    { email: "governed.foreign.nine@linaw.test", role: "owner", organizationId: beta },
  ];
  for (const actor of actorDefinitions) {
    const [user] = await db.insert(users).values({ email: actor.email,
      name: "Fictional governed reviewer", role: actor.role, passwordHash: hashPassword(password),
      backupCodes: [], totpEnabled: false }).returning();
    await db.insert(userOrganizations).values({ userId: user.id,
      organizationId: actor.organizationId, role: actor.role });
  }
  const owner = await login(actorDefinitions[0].email, password);
  const creator = await login("hiring.nine@linaw.test", password);
  const reviewer = await login(actorDefinitions[1].email, password);
  const betaOwner = await login(actorDefinitions[2].email, password);
  const direct = await owner.json("/api/employees", "POST", {
    organizationId: alpha, employeeNo: "NINE-GOV-BYPASS",
    firstName: "Fictional", lastName: "DirectBypass", title: "Worker",
    region: "NCR", payBasis: "monthly", rateAmount: 28000,
    startDate: startDate,
  });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.code, "HCM_GOVERNED_HIRE_REQUIRED");
  report.checks.push("Direct employee-create denied after employer Hire policy configured");

  const requisition = await owner.ok("/api/recruitment", "POST", {
    entityType: "requisition", organizationId: alpha, positionId: position.id,
  });
  assert.ok(Number(requisition.id) > 0);
  const candidate = await owner.ok("/api/recruitment", "POST", {
    entityType: "applicant", organizationId: alpha,
    requisitionId: requisition.id, fullName: "Fictional Governed Worker",
    email: "governed.nine@linaw.test",
  });
  assert.ok(Number(candidate.id) > 0);
  for (const stage of ["screening", "interview", "offer"]) {
    const changed = await owner.ok("/api/recruitment", "PATCH", {
      applicantId: candidate.id, stage,
      ...(stage === "offer" ? { offeredSalary: 28000 } : {}),
    });
    assert.equal(changed.stage, stage);
  }
  report.steps.push("Approved fixture position -> real requisition API -> real candidate stage/offer APIs");

  const hire = {
    applicantId: candidate.id, employeeNo: "NINE-GOV-002",
    firstName: "Fictional", lastName: "Governed",
    startDate: startDate, region: "NCR",
    payBasis: "monthly", rateAmount: 28000,
    standardWorkDaysPerMonth: 22, standardHoursPerDay: 8,
  };
  const requested = await creator.json("/api/recruitment/hire", "POST", hire);
  assert.equal(requested.status, 202);
  assert.equal(requested.body.approvalRequired, true);
  assert.equal(requested.body.employeeCreated, false);
  const processId = Number(requested.body.businessProcess?.id);
  assert.ok(processId > 0);
  const retry = await creator.json("/api/recruitment/hire", "POST", hire);
  assert.equal(retry.status, 202);
  assert.equal(Number(retry.body.businessProcess?.id), processId,
    "A repeated hire request must not create a second approval process");
  let beforeWorker = await db.select({ id: employees.id }).from(employees).where(and(
    eq(employees.organizationId, alpha), eq(employees.employeeNo, "NINE-GOV-002"),
  ));
  assert.equal(beforeWorker.length, 0, "No worker/pay profile before independent approval");
  report.steps.push("HR initiator requested Hire BP twice; one pending process; no worker created");

  const [firstStep] = await db.select().from(hcmBusinessProcessInstanceSteps).where(and(
    eq(hcmBusinessProcessInstanceSteps.instanceId, processId),
    eq(hcmBusinessProcessInstanceSteps.stepIndex, 0),
  )).limit(1);
  assert.equal(firstStep?.status, "pending");
  assert.ok(Number(firstStep.approvalTaskId) > 0);
  const deniedMaker = await creator.json("/api/approvals/" + firstStep.approvalTaskId,
    "PATCH", { status: "Approved" });
  assert.equal(deniedMaker.status, 403, "Initiator cannot approve their own HCM Hire BP");
  const deniedForeign = await betaOwner.json("/api/approvals/" + firstStep.approvalTaskId,
    "PATCH", { status: "Approved" });
  assert.equal(deniedForeign.status, 404, "Tenant B must not inspect/decide A's approval");
  const firstApproved = await reviewer.json("/api/approvals/" + firstStep.approvalTaskId,
    "PATCH", { status: "Approved" });
  assert.equal(firstApproved.status, 200, "Separate HR reviewer must decide first step");
  report.checks.push("Maker denied; foreign-tenant reviewer denied; separate HR reviewer approved");

  const [secondStep] = await db.select().from(hcmBusinessProcessInstanceSteps).where(and(
    eq(hcmBusinessProcessInstanceSteps.instanceId, processId),
    eq(hcmBusinessProcessInstanceSteps.stepIndex, 1),
  )).limit(1);
  assert.equal(secondStep?.status, "pending");
  assert.ok(Number(secondStep.approvalTaskId) > 0);
  const wrongRole = await reviewer.json("/api/approvals/" + secondStep.approvalTaskId,
    "PATCH", { status: "Approved" });
  assert.equal(wrongRole.status, 403, "HR reviewer cannot impersonate owner");
  const finalApproved = await owner.json("/api/approvals/" + secondStep.approvalTaskId,
    "PATCH", { status: "Approved" });
  assert.equal(finalApproved.status, 200);
  const [ready] = await db.select().from(hcmBusinessProcessInstances).where(
    eq(hcmBusinessProcessInstances.id, processId),
  ).limit(1);
  assert.equal(ready.status, "approved");
  beforeWorker = await db.select({ id: employees.id }).from(employees).where(and(
    eq(employees.organizationId, alpha), eq(employees.employeeNo, "NINE-GOV-002"),
  ));
  assert.equal(beforeWorker.length, 0, "Approved process alone must not create a worker");
  report.steps.push("Real HR and Owner role sessions separately approved BP; worker still not created");

  const converted = await creator.json("/api/recruitment/hire", "POST", hire);
  assert.equal(converted.status, 201);
  assert.equal(converted.body.approvalRequired, false);
  assert.equal(converted.body.businessProcess?.status, "applied");
  const workerId = Number(converted.body.employee?.id);
  assert.ok(workerId > 0);
  const duplicate = await creator.json("/api/recruitment/hire", "POST", hire);
  assert.equal(duplicate.status, 409, "Second conversion must not duplicate authoritative worker");
  const [[worker], [payProfile], [linkedCandidate], [linkedRequisition], [linkedPosition]] = await Promise.all([
    db.select().from(employees).where(and(
      eq(employees.id, workerId), eq(employees.organizationId, alpha),
    )).limit(1),
    db.select().from(employeePayProfiles).where(and(
      eq(employeePayProfiles.employeeId, workerId), eq(employeePayProfiles.organizationId, alpha),
    )).limit(1),
    db.select().from(jobApplicants).where(eq(jobApplicants.id, candidate.id)).limit(1),
    db.select().from(jobRequisitions).where(eq(jobRequisitions.id, requisition.id)).limit(1),
    db.select().from(positions).where(eq(positions.id, position.id)).limit(1),
  ]);
  assert.equal(worker.employeeNo, "NINE-GOV-002");
  assert.equal(worker.startDate, startDate);
  assert.equal(payProfile.payBasis, "monthly");
  assert.equal(Number(payProfile.rateAmount), 28000);
  assert.equal(linkedCandidate.hiredEmployeeId, workerId);
  assert.equal(linkedCandidate.stage, "hired");
  assert.equal(linkedRequisition.status, "filled");
  assert.equal(linkedPosition.status, "filled");
  const [assignment] = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, alpha),
    eq(positionAssignments.employeeId, workerId),
  )).limit(1);
  assert.equal(assignment?.positionId, position.id);
  assert.equal(assignment?.effectiveFrom, startDate);
  const onboarding = await db.select().from(provisioningTasks).where(and(
    eq(provisioningTasks.organizationId, alpha),
    eq(provisioningTasks.employeeId, workerId),
    eq(provisioningTasks.kind, "onboarding"),
  ));
  assert.ok(onboarding.length >= 5);
  const events = await db.select().from(workerEmploymentEvents).where(and(
    eq(workerEmploymentEvents.organizationId, alpha),
    eq(workerEmploymentEvents.employeeId, workerId),
  ));
  assert.ok(events.length >= 1);
  const steps = await db.select().from(hcmBusinessProcessInstanceSteps).where(
    eq(hcmBusinessProcessInstanceSteps.instanceId, processId),
  );
  assert.equal(steps.length, 2);
  assert.ok(steps.every(s => s.status === "completed"));
  assert.ok(steps.every(s => s.completedByUserId !== creatorUser.id));
  const [applied] = await db.select().from(hcmBusinessProcessInstances).where(
    eq(hcmBusinessProcessInstances.id, processId),
  );
  assert.equal(applied.status, "applied");

  const releasedEntriesAfter = await db.select().from(payrollEntries).where(eq(
    payrollEntries.payrollRunId, released.id,
  ));
  assert.deepEqual(releasedEntriesAfter, releasedEntriesBefore,
    "Future governed worker must not rewrite previously released payroll entries");
  const [stillReleased] = await db.select().from(payrollRuns).where(eq(
    payrollRuns.id, released.id,
  ));
  assert.equal(stillReleased.status, "Released");
  report.checks.push("One worker, one pay profile, one active position, tasks, event, two separate approvals");
  report.checks.push("Duplicate candidate conversion denied; original released payroll register immutable");
  report.steps.push("Approved candidate converted through real API into authoritative worker and onboarding");
  report.status = "PASS";
}
main().catch(error => {
  report.status = "FAIL";
  // Bounded synthetic-only failure text. Never print response bodies or credentials.
  report.checks.push("FAIL: " + (error instanceof Error ? error.message.slice(0, 190) : "unknown"));
  process.exitCode = 1;
}).finally(async () => {
  save();
  console.log("Governed Hire #853 synthetic sidecar=" + report.status +
    " (NOT connected payroll worker, NOT human UAT)");
  await pool.end();
});

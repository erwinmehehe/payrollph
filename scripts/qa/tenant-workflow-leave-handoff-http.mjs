/**
 * Two genuine multi-action tenant HTTP proofs:
 * POST /api/leave and POST /api/governed-handoffs.
 * Never import the application or database before the exact disposable CI guard.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireDisposable(env = process.env) {
  const safe = env.GITHUB_ACTIONS === "true" && env.CI === "true" &&
    env.NODE_ENV === "production" && env.DEMO_MODE === "false" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.TENANT_WORKFLOW_WRITES_MODE === "fictional-pg16-http" &&
    env.DATABASE_URL === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    env.SECURITY_SMOKE_URL === "http://127.0.0.1:3000" &&
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
      "XENDIT_BILLING_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
      "NEXT_CSP_ENABLED"].every(key => env[key] === "false") &&
    ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
      "SMTP_URL", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "OPENAI_API_KEY"]
      .every(key => !env[key]);
  if (!safe) throw new Error("WORKFLOW_WRITES_PROOF_REFUSED: isolated PG16 CI, no providers, no CSP required");
}
requireDisposable();

const [{db, pool}, schema, {eq, asc, and, sql}, fixture] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
  import("drizzle-orm"), import("./tenant-table-http.mjs"),
]);
const {
  organizations, users, userOrganizations, employees, approvalTasks,
  approvalChainPolicies, approvalChainInstances, approvalChainInstanceSteps,
  leavePolicies, leaveRequests, leaveRequestIntervalSets, leaveRequestIntervals,
  separationRecords, worksites, shiftDefinitions, openShifts, openShiftClaims,
  auditEvents, payrollRuns, outbox, workforceTimesheets,
} = schema;
const {seedEmployer, addWorker, standaloneMakeSession, standaloneRequest} = fixture;
const marker = randomUUID().replaceAll("-", "").slice(0, 10);
const attest = [];

function need(value, reason) {
  assert.ok(value, reason);
  attest.push(reason);
}
function status(r, expected, label) {
  assert.equal(r.status, expected, label + " expected " + expected + ", got " +
    r.status + ": " + String(r.text).slice(0, 240));
  return r;
}
const post = (path, cookie, body) => standaloneRequest(path, {
  method: "POST", cookie, body,
});
async function ownOrgSnapshot(orgId) {
  const tables = {
    employees, userOrganizations, approvalTasks, approvalChainPolicies,
    approvalChainInstances, approvalChainInstanceSteps, leavePolicies,
    leaveRequests, leaveRequestIntervalSets, leaveRequestIntervals,
    separationRecords, worksites, shiftDefinitions, openShifts, openShiftClaims,
    auditEvents, payrollRuns, outbox, workforceTimesheets,
  };
  const result = {};
  for (const [name, table] of Object.entries(tables)) {
    result[name] = await db.select().from(table).where(eq(table.organizationId, orgId))
      .orderBy(asc(table.id));
  }
  return result;
}
async function assertDenied(promise, expected, victim, label) {
  const r = status(await promise, expected, label);
  need(typeof r.json?.error === "string" && r.json.error.length > 0,
    label + " must return a structured error");
  const all = r.text + [...r.headers].map(([k,v]) => k + ":" + v).join(" ");
  need(!all.includes(victim.marker) && !all.includes(victim.cookie.split("=")[1]),
    label + " must not expose victim data, identifier markers or session");
  return r;
}
async function ensureEmpty() {
  for (const [label, table] of [["organizations", organizations],
    ["leave_requests", leaveRequests], ["approval_chain_instances", approvalChainInstances]]) {
    assert.equal((await db.select().from(table).limit(1)).length, 0,
      "Refusing nonempty PG16 proof database at " + label);
  }
}
async function setupEmployer(e) {
  await db.insert(leavePolicies).values({
    organizationId: e.org.id, leaveType: "Vacation", annualDays: "12.0",
    payTreatment: "paid", active: true,
  });
  const [checker] = await db.insert(users).values({
    email: e.marker.toLowerCase() + "-checker@example.invalid",
    name: e.marker + " independent HR checker",
    passwordHash: "fictional-only", role: "hr", active: true,
  }).returning();
  await db.insert(userOrganizations).values({
    organizationId: e.org.id, userId: checker.id, role: "hr", active: true,
  });
  e.checker = checker;
  await db.insert(approvalChainPolicies).values({
    organizationId: e.org.id, code: "tenant-qa-chain", name: "Fictional human review",
    purpose: "automation", active: true, createdByUserId: e.owner.id,
    steps: [{label:"Fictional independent review", approver:"role:owner"}],
  });
  const [site] = await db.insert(worksites).values({
    organizationId: e.org.id, orgUnitId: e.unit.id,
    code: "qa-site-" + e.label.toLowerCase(), name: e.marker + " site",
  }).returning();
  const [shift] = await db.insert(shiftDefinitions).values({
    organizationId: e.org.id, code: "qa-shift-" + e.label.toLowerCase(),
    name: "Fictional day shift", startTime: "09:00", endTime: "17:00",
  }).returning();
  e.site = site;
  e.shift = shift;
}
async function seedSeparation(e, employeeId = e.worker.id) {
  const [row] = await db.insert(separationRecords).values({
    organizationId: e.org.id, employeeId,
    separationType: "resignation", noticeDate: "2026-11-16",
    lastDay: "2026-12-15", status: "draft",
  }).returning();
  return row;
}
async function seedClaim(e, employeeId = e.worker.id) {
  const [shift] = await db.insert(openShifts).values({
    organizationId: e.org.id, worksiteId: e.site.id,
    shiftDefinitionId: e.shift.id, workDate: "2026-11-20",
    status: "open", slots: 1,
  }).returning();
  const [row] = await db.insert(openShiftClaims).values({
    organizationId: e.org.id, openShiftId: shift.id, employeeId,
    requestedBy: e.owner.name, requestedByUserId: e.owner.id,
    status: "pending",
  }).returning();
  return row;
}
const leaveBody = (e, workerId = e.leaveWorker.id) => ({
  organizationId: e.org.id, employeeId: workerId, leaveType: "Vacation",
  startDate: "2026-11-19", endDate: "2026-11-19", days: 1,
  reason: "Synthetic one-day leave, no real employee",
  intervals: [{workDate:"2026-11-19", kind:"full_day", timezone:"Asia/Manila"}],
});
const handoffBody = (e, sourceType, sourceId) => ({
  organizationId: e.org.id, sourceType, sourceId, chainCode:"tenant-qa-chain",
});

try {
  await ensureEmpty();
  const a = await seedEmployer("ATTA", marker, standaloneMakeSession);
  const b = await seedEmployer("ATTB", marker, standaloneMakeSession);
  const v = await seedEmployer("VICTIM", marker, standaloneMakeSession);
  const attackers = [a, b];
  need(v.org.id > b.org.id && v.owner.id > b.owner.id,
    "real victim employer/user IDs exceed attacker comparators");
  for (const e of [a,b,v]) await setupEmployer(e);
  // The forged policy code below is a genuine victim-owned database policy.
  await db.insert(approvalChainPolicies).values({
    organizationId:v.org.id, code:"victim-only-approval-policy",
    name:"Fictional victim-exclusive human policy", purpose:"automation", active:true,
    createdByUserId:v.owner.id,
    steps:[{label:"Victim-only review",approver:"role:owner"}],
  });
  // Ensure targeted victim selectors are actual PG-backed IDs > 6, never invented IDs.
  for (let i=0;i<6;i++) await addWorker(v, "FILLER"+i, {payProfile:false});
  const targetWorker = await addWorker(v, "TARGET", {payProfile:false});
  need(targetWorker.id > 6 && targetWorker.id > b.worker.id,
    "victim worker is a real higher-ID persisted employee");

  const aSep = await seedSeparation(a), bSep = await seedSeparation(b);
  const aClaim = await seedClaim(a), bClaim = await seedClaim(b);
  for (let i=0;i<6;i++) { await seedSeparation(v); await seedClaim(v); }
  const victimSep = await seedSeparation(v, targetWorker.id);
  const victimClaim = await seedClaim(v, targetWorker.id);
  need(victimSep.id > 6 && victimSep.id > bSep.id,
    "real victim separation ID exceeds both attacker source IDs");
  need(victimClaim.id > 6 && victimClaim.id > bClaim.id,
    "real victim roster claim ID exceeds both attacker source IDs");
  // Leave eligibility rejects draft-separation workers: use distinct, real active HR workers.
  for (const e of [a,b,v]) e.leaveWorker = await addWorker(e,"LEAVE",{payProfile:false});
  need(v.leaveWorker.id > 6 && v.leaveWorker.id > b.leaveWorker.id,
    "victim leave worker is a real higher-ID employee with no separation");

  const sepId = new Map([[a,aSep.id],[b,bSep.id],[v,victimSep.id]]);
  const claimId = new Map([[a,aClaim.id],[b,bClaim.id],[v,victimClaim.id]]);
  // POSITIVE #1 (handoffs): both genuine action variants for each independent employer.
  const firstHandoffs = new Map();
  for (const e of [a,b,v]) {
    for (const [kind,id] of [["hcm_separation_readiness",sepId.get(e)],
      ["wfm_roster_claim_review",claimId.get(e)]]) {
      const r = status(await post("/api/governed-handoffs",e.cookie,
        handoffBody(e,kind,id)),201,e.label+" own governed "+kind);
      need(Number.isInteger(r.json?.approval?.id) && r.json.approval.id > 0 &&
        Number.isInteger(r.json.approval.taskId) &&
        /^[a-f0-9]{64}$/.test(r.json.approval.sourceHash),
      "own governed handoff returns real persisted approval and source hash");
      const [saved] = await db.select().from(approvalChainInstances)
        .where(eq(approvalChainInstances.id,r.json.approval.id));
      need(saved?.organizationId === e.org.id && saved.sourceType === kind &&
        saved.policyCode === "tenant-qa-chain" && saved.status === "pending",
      "own governed handoff belongs to authenticated employer and active policy");
      firstHandoffs.set(e.label + ":" + kind, r.json.approval);
    }
  }

  // Both handoff source types must support a genuine idempotent replay and a
  // changed-source follow-up without adopting another tenant's approval.
  for (const e of attackers) {
    for (const [kind,id] of [["hcm_separation_readiness",sepId.get(e)],
      ["wfm_roster_claim_review",claimId.get(e)]]) {
      const original = firstHandoffs.get(e.label + ":" + kind);
      const instancesBefore = await db.select().from(approvalChainInstances)
        .where(eq(approvalChainInstances.organizationId,e.org.id));
      const tasksBefore = await db.select().from(approvalTasks)
        .where(eq(approvalTasks.organizationId,e.org.id));
      const replay = status(await post("/api/governed-handoffs",e.cookie,
        handoffBody(e,kind,id)),201,e.label+" idempotent "+kind+" own retry");
      need(replay.json.approval.id === original.id &&
        replay.json.approval.taskId === original.taskId &&
        replay.json.approval.sourceHash === original.sourceHash,
        kind+" exact own replay returns same persisted source-bound chain and task");
      assert.equal((await db.select().from(approvalChainInstances)
        .where(eq(approvalChainInstances.organizationId,e.org.id))).length,
        instancesBefore.length, "idempotent replay may not duplicate approval instances");
      assert.equal((await db.select().from(approvalTasks)
        .where(eq(approvalTasks.organizationId,e.org.id))).length,
        tasksBefore.length, "idempotent replay may not duplicate approval tasks");

      if (kind === "hcm_separation_readiness") {
        await db.update(separationRecords).set({noticeDate:"2026-11-17"}).where(and(
          eq(separationRecords.organizationId,e.org.id),eq(separationRecords.id,id)));
      } else {
        await db.update(openShiftClaims).set({
          reason:"Synthetic changed claim evidence for independent human review",
        }).where(and(eq(openShiftClaims.organizationId,e.org.id),eq(openShiftClaims.id,id)));
      }
      const changed = status(await post("/api/governed-handoffs",e.cookie,
        handoffBody(e,kind,id)),201,e.label+" changed-source "+kind+" own follow-up");
      need(changed.json.approval.id !== original.id &&
        changed.json.approval.sourceHash !== original.sourceHash &&
        changed.json.approval.taskId !== original.taskId,
        kind+" changed real source creates NEW version-bound approval and task");
      const [fresh] = await db.select().from(approvalChainInstances)
        .where(eq(approvalChainInstances.id,changed.json.approval.id));
      need(fresh?.organizationId === e.org.id && fresh.sourceType === kind &&
        fresh.sourceKey === id + ":" + changed.json.approval.sourceHash,
        "changed handoff has persisted employer-bound new source hash/version");
    }
  }

  // A deliberate PostgreSQL audit insert failure must NEVER commit an approval.
  // Without the separately labelled atomic source fix, this 409 would silently
  // leave orphan approval/task/step rows and the SQL snapshot would fail.
  const faultSep = await seedSeparation(a);
  const faultBefore = await ownOrgSnapshot(a.org.id);
  await db.execute(sql.raw("CREATE FUNCTION tenant_qa_fail_handoff_audit() RETURNS trigger LANGUAGE plpgsql AS $audit$ BEGIN IF NEW.action = 'Governed WFM/HCM human approval handoff requested' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAULT_PRIVATE_ONLY'; END IF; RETURN NEW; END; $audit$"));
  await db.execute(sql.raw("CREATE TRIGGER tenant_qa_handoff_audit_denial BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION tenant_qa_fail_handoff_audit()"));
  try {
    const failed = await assertDenied(post("/api/governed-handoffs",a.cookie,
      handoffBody(a,"hcm_separation_readiness",faultSep.id)),
      409,v,"own governed handoff forced audit failure must roll back all writes");
    need(failed.json.code === "GOVERNED_HANDOFF_UNAVAILABLE" &&
      !failed.text.includes("SYNTHETIC_AUDIT_FAULT_PRIVATE_ONLY"),
      "audit fault returns sanitized 409 without revealing exception or SQL");
    assert.deepEqual(await ownOrgSnapshot(a.org.id),faultBefore,
      "forced audit exception leaves zero orphaned approval, task, step or audit changes");
  } finally {
    await db.execute(sql.raw("DROP TRIGGER tenant_qa_handoff_audit_denial ON audit_events"));
    await db.execute(sql.raw("DROP FUNCTION tenant_qa_fail_handoff_audit()"));
  }
  const recovered = status(await post("/api/governed-handoffs",a.cookie,
    handoffBody(a,"hcm_separation_readiness",faultSep.id)),
    201,"audit-failed source retries successfully without half-committed records");
  need(recovered.json?.approval?.id>0 && recovered.json?.approval?.taskId>0,
    "audit-failed source becomes a persisted real handoff after recovery");

  // POSITIVE #2 (leave create): two independent signed-in own submissions + real victim.
  const ownLeaves = new Map();
  for (const e of [a,b,v]) {
    if (e===v) {
      for (let j=0;j<6;j++) await db.insert(leaveRequests).values({
        organizationId:v.org.id, employeeId:v.leaveWorker.id,
        leaveType:"Vacation", startDate:"2026-11-19", endDate:"2026-11-19",
        days:"1.0", reason:"Inert victim-side higher-ID proof padding", status:"Pending",
      });
    }
    const r = status(await post("/api/leave",e.cookie,
      leaveBody(e,e.leaveWorker.id)),201,e.label+" own leave POST");
    need(r.json?.organizationId === e.org.id &&
      r.json.employeeId === e.leaveWorker.id &&
      r.json.status === "Pending" && Number.isInteger(r.json.id) &&
      Number.isInteger(r.json.approvalTaskId),
    "real leave POST returns persisted own leave and independent checker task");
    const [saved] = await db.select().from(leaveRequests)
      .where(eq(leaveRequests.id,r.json.id));
    need(saved?.organizationId === e.org.id &&
      saved.approvalTaskId === r.json.approvalTaskId,
    "own leave and approval task persist in PostgreSQL");
    ownLeaves.set(e,r.json);
  }
  const victimLeave=ownLeaves.get(v);
  need(victimLeave.id > ownLeaves.get(b).id && victimLeave.id > 6,
    "victim leave is real, with higher ID than attacker leaves");
  // Real connected victim timesheet: revision code can mark these rows stale.
  const submittedTimesheets = new Map();
  for (const e of [a,b,v]) {
    const [t] = await db.insert(workforceTimesheets).values({
      organizationId:e.org.id,employeeId:e.leaveWorker.id,
      periodStart:"2026-11-19",periodEnd:"2026-11-19",
      status:"submitted",snapshotHash:"a".repeat(64),
    }).returning();
    submittedTimesheets.set(e,t);
  }
  // POST revise_intervals is another reachable action of the SAME leave method.
  for(const e of [a,b]) {
    const row=ownLeaves.get(e);
    const r=status(await post("/api/leave",e.cookie,{
      organizationId:e.org.id,action:"revise_intervals",leaveId:row.id,
      employeeId:targetWorker.id,runId:victimLeave.id,
      intervals:[{workDate:"2026-11-19",kind:"full_day",timezone:"Asia/Manila"}],
    }),200,e.label+" owned revision, forged unrelated selectors ignored");
    need(r.json?.intervalSet?.organizationId===e.org.id &&
      r.json.intervalSet.leaveRequestId===row.id &&
      r.json.intervalSet.revision===2,
      "own precise timing revision writes only the selected employer");
    const ownTimesheet = submittedTimesheets.get(e);
    const [stale] = await db.select().from(workforceTimesheets).where(and(
      eq(workforceTimesheets.id,ownTimesheet.id),
      eq(workforceTimesheets.organizationId,e.org.id)));
    need(stale?.status === "stale" &&
      r.json.staleTimesheetIds.includes(ownTimesheet.id),
      "own revision stales only its persisted own submitted timesheet");
  }
  const [victimSubmitted] = await db.select().from(workforceTimesheets)
    .where(eq(workforceTimesheets.id,submittedTimesheets.get(v).id));
  need(victimSubmitted?.status === "submitted",
    "victim's real submitted timesheet stays intact after own revisions");

  // Checker revocation during POST /leave: force HTTP to block at the
  // transaction's SELECT FOR SHARE AFTER it selected an approver in preflight.
  // Revoking that role before releasing the worker lock must reject all writes.
  const revokeWorker = await addWorker(a,"REVOKE",{payProfile:false});
  const beforeRevocation = await ownOrgSnapshot(a.org.id);
  const holder = await pool.connect();
  let held = false;
  let pendingLeave;
  try {
    await holder.query("BEGIN");
    await holder.query(
      "SELECT id FROM employees WHERE organization_id = $1 AND id = $2 FOR UPDATE",
      [a.org.id,revokeWorker.id]);
    held = true;
    pendingLeave = post("/api/leave",a.cookie,leaveBody(a,revokeWorker.id));
    let blocked = false;
    for (let attempt=0; attempt<150; attempt++) {
      const waiting = await pool.query("SELECT pid FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query ILIKE '%from employees%' AND query ILIKE '%for share%'");
      if (waiting.rows.length > 0) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve,60));
    }
    need(blocked, "leave request reached transaction's shared employee lock after initial checker selection");
    await db.update(userOrganizations).set({active:false}).where(and(
      eq(userOrganizations.organizationId,a.org.id),
      eq(userOrganizations.userId,a.checker.id)));
    await holder.query("COMMIT");
    held = false;
    const refused = status(await pendingLeave,409,
      "leave POST rejects approver revoked between preflight and transaction");
    need(refused.json.code === "LEAVE_APPROVER_CHANGED",
      "revoked checker is rejected by the in-transaction membership/role recheck");
    const after = await ownOrgSnapshot(a.org.id);
    for (const [table, rows] of Object.entries(beforeRevocation)) {
      if (table === "userOrganizations") continue; // intentionally revoked checker
      assert.deepEqual(after[table], rows,
        "revoked HR checker creates no "+table+" business, timesheet or audit mutation");
    }
    need(after.userOrganizations.find(x=>x.userId===a.checker.id)?.active===false,
      "checker is really revoked in disposable PostgreSQL before leave commits");
  } finally {
    if (held) await holder.query("ROLLBACK");
    holder.release();
    if (pendingLeave) await pendingLeave.catch(()=>null);
  }

  const baseline = new Map(await Promise.all([a,b,v].map(async e =>
    [e.org.id,await ownOrgSnapshot(e.org.id)])));
  // DENIAL #2 and FORGERY #4: real victim selectors, not fabricated IDs.
  for(const e of attackers) {
    await assertDenied(post("/api/leave",e.cookie,{
      ...leaveBody(e,v.leaveWorker.id),organizationId:v.org.id,
    }),403,v,"foreign leave organization+worker");
    await assertDenied(post("/api/leave",e.cookie,leaveBody(e,v.leaveWorker.id)),
      404,v,"forged victim employee in own leave workspace");
    await assertDenied(post("/api/leave",e.cookie,{
      organizationId:e.org.id,action:"revise_intervals",leaveId:victimLeave.id,
      intervals:[{workDate:"2026-11-19",kind:"full_day",timezone:"Asia/Manila"}],
    }),404,v,"foreign victim leave revision path in own workspace");
    await assertDenied(post("/api/leave",e.cookie,{
      organizationId:v.org.id,action:"revise_intervals",leaveId:victimLeave.id,
      intervals:[{workDate:"2026-11-19",kind:"full_day",timezone:"Asia/Manila"}],
    }),403,v,"foreign victim employer revision request");
    for(const [type,id] of [["hcm_separation_readiness",victimSep.id],
      ["wfm_roster_claim_review",victimClaim.id]]) {
      await assertDenied(post("/api/governed-handoffs",e.cookie,{
        ...handoffBody(e,type,id),organizationId:v.org.id,
      }),403,v,"foreign governed organization+real "+type);
      await assertDenied(post("/api/governed-handoffs",e.cookie,
        handoffBody(e,type,id)),404,v,"forged genuine foreign source in own "+type);
    }
    await assertDenied(post("/api/governed-handoffs",e.cookie,{
      ...handoffBody(e,"hcm_separation_readiness",sepId.get(e)),
      chainCode:"victim-only-approval-policy",
    }),409,v,"forged unavailable approval-chain selector");
  }
  // UNCHANGED-DB #3: same before and after denied and forged traffic, all related tables.
  for (const e of [a,b,v]) {
    assert.deepEqual(await ownOrgSnapshot(e.org.id),baseline.get(e.org.id),
      e.label+" all leave, approval, handoff, audit, payroll and outbox PG16 rows unchanged");
  }
  console.log(JSON.stringify({kind:"tenant-workflow-leave-handoffs-pg16-http",
    methods:["POST leave (create+revise_intervals)",
      "POST governed-handoffs (separation+roster)"],
    independentOwnEmployers:2, realVictimEmployeeId:targetWorker.id,
    realVictimLeaveId:victimLeave.id, realVictimSeparationId:victimSep.id,
    realVictimClaimId:victimClaim.id, fourPartAssertions:attest.length,
    unchangedVictimAndAttackerDb:true, providerFlags:"OFF",
    productionTested:false, methodCredits:0}));
} finally {
  await pool.end();
}

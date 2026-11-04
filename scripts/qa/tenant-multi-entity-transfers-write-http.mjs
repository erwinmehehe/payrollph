/**
 * MULTI-ENTITY transfers POST/PATCH, synthetic PG16 real HTTPS proof.
 * One endpoint family only. No customer DB, provider, payout, or release.
 * This is a proof candidate, not an automatic tenant-isolation credit.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";

const ORIGIN = "https://127.0.0.1:3002";
const PASSWORD = "Synthetic-Entity-QA-2026-Only!";
function requireDisposable() {
  for (const [key, value] of [
    ["CI", "true"], ["GITHUB_ACTIONS", "true"],
    ["MULTI_ENTITY_QA_MODE", "synthetic-postgres-only"],
    ["MULTI_ENTITY_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "false"],
    ["XENDIT_PAYOUTS_ENABLED", "false"],
    ["REQUIRE_PRIVILEGED_MFA", "false"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"],
  ]) assert.equal(process.env[key], value, key + " must be isolated synthetic QA");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.notEqual(process.env.PAYMONGO_SECRET_KEY?.length > 0, true);
  assert.notEqual(process.env.XENDIT_SECRET_KEY?.length > 0, true);
}
requireDisposable();

function manilaDate(shiftDays = 0) {
  const date = new Date(Date.now() + shiftDays * 86400000);
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}
const browser = await chromium.launch({ headless: true });
const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
const contexts = [];
let count = 0;
const check = (value, label) => { assert.ok(value, label); count++; };
const one = async (statement, params = []) => {
  const result = await sql.query(statement, params);
  assert.equal(result.rows.length, 1, "Fictional fixture expected one row");
  return result.rows[0];
};
const snapshot = async (orgId) => {
  const result = {};
  for (const table of ["entity_transfer_requests", "employees", "payroll_runs", "audit_events"]) {
    const rows = await sql.query("SELECT * FROM " + table + " WHERE organization_id=$1 ORDER BY id", [orgId]);
    result[table] = rows.rows;
  }
  return result;
};
async function login(email, ip) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  contexts.push(context);
  const response = await context.request.post(ORIGIN + "/api/auth/login", {
    headers: {
      "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin",
      "x-forwarded-for": ip,
    },
    data: { email, password: PASSWORD }, failOnStatusCode: false,
  });
  assert.equal(response.status(), 200, "Real fictional login required for " + email);
  const session = (await context.cookies(ORIGIN)).find(row => row.name === "__Host-linaw_session");
  check(session?.secure && session.httpOnly, "Authenticated context needs Secure HttpOnly session");
  return context;
}
async function call(context, method, path, body, legalEntityId) {
  const headers = {};
  if (legalEntityId) headers["x-legal-entity-id"] = String(legalEntityId);
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers.origin = ORIGIN;
    headers["sec-fetch-site"] = "same-origin";
  }
  const response = await context.request.fetch(ORIGIN + path, {
    method, headers, data: body, failOnStatusCode: false, maxRedirects: 0,
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* Non-JSON is never an own success. */ }
  return { status: response.status(), text, data };
}
function status(response, wanted, label) {
  assert.equal(response.status, wanted, label + ": got HTTP " + response.status
    + " " + (response.data?.error ?? "").slice(0, 180));
  count++;
  return response;
}

try {
  await sql.connect();
  const owner = await one("SELECT id FROM users WHERE email=$1", ["entity-owner@example.test"]);
  const checker = await one("SELECT id FROM users WHERE email=$1", ["entity-checker@example.test"]);
  const foreign = await one("SELECT id FROM users WHERE email=$1", ["entity-foreign@example.test"]);
  const victimWorker = await one(
    "SELECT id,organization_id,legal_entity_id FROM employees WHERE employee_no='B-VICTIM-7'");
  const sourceWorker = await one(
    "SELECT id,organization_id,legal_entity_id FROM employees WHERE employee_no='A-01'");
  const secondWorker = await one(
    "SELECT id,organization_id,legal_entity_id,start_date FROM employees WHERE employee_no='A-02'");
  const secondaryEntity = await one(
    "SELECT id FROM legal_entities WHERE organization_id=1 AND code='SECOND'");
  const victimEntity = await one(
    "SELECT id FROM legal_entities WHERE organization_id=2 AND code='PRIMARY'");
  check(sourceWorker.organization_id === 1 && sourceWorker.legal_entity_id > 0,
    "The maker owns a genuine source worker");
  check(secondWorker.organization_id === 1 &&
    secondWorker.legal_entity_id === secondaryEntity.id,
    "Second source worker belongs to second legal employer");
  check(victimWorker.organization_id === 2 && victimWorker.id > 6,
    "The other employer has a real victim-only higher-ID worker");
  check(owner.id !== checker.id && foreign.id !== owner.id,
    "Maker, checker and foreign actor must be distinct");
  const primaryId = sourceWorker.legal_entity_id;
  const future = manilaDate(60);
  const today = manilaDate(0);

  const a = await login("entity-owner@example.test", "198.51.100.13");
  const b = await login("entity-checker@example.test", "198.51.100.18");
  const attackerB = await login("entity-foreign@example.test", "198.51.100.17");
  const attackerC = await login("entity-attacker-c@example.test", "198.51.100.20");

  // Seed a genuine foreign pending transfer, never a guessed identifier.
  const victimSecondary = await one(
    "INSERT INTO legal_entities (organization_id,code,legal_name,display_name,primary_entity) VALUES(2,'CI-SECOND','Fictional B second','B second',false) RETURNING id");
  const victimMove = await one(
    "INSERT INTO entity_transfer_requests(organization_id,employee_id,from_legal_entity_id,to_legal_entity_id,effective_date,status,reason,service_start_date,requested_by_user_id,continuity_note) VALUES(2,$1,$2,$3,$4,'pending_approval','Synthetic foreign pending transfer','2026-01-01',$5,'fictional tenant proof') RETURNING id",
    [victimWorker.id, victimEntity.id, victimSecondary.id, future, foreign.id]);
  const victimBefore = await snapshot(2);
  check(victimMove.id > 0 && victimBefore.entity_transfer_requests.some(row => row.id === victimMove.id),
    "Victim transfer must actually exist before denial tests");

  const path = "/api/multi-entity/transfers";
  const createBody = (workerId, target, effectiveDate) => ({
    organizationId: 1, employeeId: workerId, toLegalEntityId: target,
    effectiveDate, reason: "Fictional employer movement for CI isolation only",
  });
  // Exercise a real, disposable PostgreSQL failure through the HTTP POST.
  // An otherwise valid maker action must not expose internal driver text.
  const beforePostFault = await snapshot(1);
  await sql.query("CREATE FUNCTION public.ci_transfer_post_error() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''CI_INTERNAL_DATABASE_DIAGNOSTIC''; END;'");
  await sql.query("CREATE TRIGGER ci_transfer_post_error BEFORE INSERT ON entity_transfer_requests FOR EACH ROW EXECUTE FUNCTION public.ci_transfer_post_error()");
  try {
    const deniedFault = status(await call(a, "POST", path,
      createBody(sourceWorker.id, secondaryEntity.id, future), primaryId),
      409, "Authorized POST with SQL failure is safely rejected");
    check(deniedFault.data?.error === "Could not request transfer." &&
      !deniedFault.text.includes("CI_INTERNAL_DATABASE_DIAGNOSTIC"),
      "POST must never expose database diagnostics");
    assert.deepEqual(await snapshot(1), beforePostFault,
      "SQL-failed transfer POST must not change employer or audit rows");
  } finally {
    await sql.query("DROP TRIGGER IF EXISTS ci_transfer_post_error ON entity_transfer_requests");
    await sql.query("DROP FUNCTION IF EXISTS public.ci_transfer_post_error()");
  }

  const ownCreated = status(await call(a, "POST", path,
    createBody(sourceWorker.id, secondaryEntity.id, future), primaryId),
    201, "Maker may propose a valid own-employer transfer");
  const ownId = ownCreated.data?.transfer?.id;
  check(Number.isSafeInteger(ownId) && ownId > 0, "Owned POST has a persisted transfer ID");
  const persisted = await one(
    "SELECT organization_id,employee_id,status,requested_by_user_id FROM entity_transfer_requests WHERE id=$1",
    [ownId]);
  check(persisted.organization_id === 1 && persisted.employee_id === sourceWorker.id &&
    persisted.requested_by_user_id === owner.id && persisted.status === "pending_approval",
    "Owned POST must persist exact tenant, worker, maker and pending state");

  // Both other tenant principals must fail before source or audit mutation.
  for (const attacker of [attackerB, attackerC]) {
    status(await call(attacker, "POST", path,
      createBody(sourceWorker.id, secondaryEntity.id, future), primaryId),
      403, "An authenticated foreign tenant may not propose the owner's transfer");
    status(await call(attacker, "PATCH", path,
      { organizationId: 1, id: ownId, action: "approve" }, primaryId),
      403, "An authenticated foreign tenant may not decide the owner's transfer");
  }
  status(await call(a, "POST", path,
    createBody(victimWorker.id, secondaryEntity.id, future), primaryId),
    404, "Foreign worker with forged own organization must look not found");
  status(await call(a, "POST", path,
    createBody(sourceWorker.id, victimEntity.id, future), primaryId),
    403, "Foreign target legal-employer grant cannot be invented");
  status(await call(b, "PATCH", path,
    { organizationId: 1, id: victimMove.id, action: "reject" }, primaryId),
    404, "A genuine foreign transfer ID under an own selector must look missing");
  status(await call(b, "PATCH", path,
    { organizationId: 2, id: victimMove.id, action: "approve" }, victimEntity.id),
    403, "Foreign transfer identity with true employer selector cannot authorize");
  status(await call(a, "PATCH", path,
    { organizationId: 1, id: ownId, action: "approve" }, primaryId),
    403, "Maker cannot approve the same transfer");

  const rejected = status(await call(b, "PATCH", path,
    { organizationId: 1, id: ownId, action: "reject" }, primaryId),
    200, "Independent checker may reject an own transfer");
  check(rejected.data?.transfer?.status === "rejected", "Rejection state persisted");
  const postReject = await one("SELECT status,approved_by_user_id FROM entity_transfer_requests WHERE id=$1", [ownId]);
  check(postReject.status === "rejected" && postReject.approved_by_user_id === checker.id,
    "Rejected case must persist checker identity");

  const nextCreated = status(await call(a, "POST", path,
    createBody(sourceWorker.id, secondaryEntity.id, future), primaryId),
    201, "A rejected case permits a new owned proposal");
  const nextId = nextCreated.data?.transfer?.id;
  check(Number.isSafeInteger(nextId) && nextId !== ownId, "A new proposal has a new real ID");
  // Prove the PATCH error boundary on a genuine checker decision.
  const beforePatchFault = await snapshot(1);
  await sql.query("CREATE FUNCTION public.ci_transfer_patch_error() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''CI_INTERNAL_DATABASE_DIAGNOSTIC''; END;'");
  await sql.query("CREATE TRIGGER ci_transfer_patch_error BEFORE UPDATE ON entity_transfer_requests FOR EACH ROW EXECUTE FUNCTION public.ci_transfer_patch_error()");
  try {
    const deniedFault = status(await call(b, "PATCH", path,
      { organizationId: 1, id: nextId, action: "approve" }, primaryId),
      409, "Authorized PATCH with SQL failure is safely rejected");
    check(deniedFault.data?.error === "Transfer could not be decided." &&
      !deniedFault.text.includes("CI_INTERNAL_DATABASE_DIAGNOSTIC"),
      "PATCH must never expose database diagnostics");
    assert.deepEqual(await snapshot(1), beforePatchFault,
      "SQL-failed transfer PATCH must not change employer or audit rows");
  } finally {
    await sql.query("DROP TRIGGER IF EXISTS ci_transfer_patch_error ON entity_transfer_requests");
    await sql.query("DROP FUNCTION IF EXISTS public.ci_transfer_patch_error()");
  }

  const approved = status(await call(b, "PATCH", path,
    { organizationId: 1, id: nextId, action: "approve" }, primaryId),
    200, "Independent checker may approve owned future transfer");
  check(approved.data?.transfer?.status === "approved",
    "Future approval cannot silently move employee");
  const stableWorker = await one("SELECT legal_entity_id FROM employees WHERE id=$1", [sourceWorker.id]);
  check(stableWorker.legal_entity_id === primaryId, "Future approval preserves live employer");
  status(await call(b, "PATCH", path,
    { organizationId: 1, id: nextId, action: "apply" }, primaryId),
    409, "Future transfer cannot be applied early");

  // Prove the remaining PATCH apply branch against a genuinely due synthetic
  // approved transfer. A fictional existing approval is seeded into PG only.
  await sql.query(
    "INSERT INTO employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from) VALUES(1,$1,$2,'2026-01-01')",
    [secondWorker.id, secondaryEntity.id]);
  const due = await one(
    "INSERT INTO entity_transfer_requests(organization_id,employee_id,from_legal_entity_id,to_legal_entity_id,effective_date,status,reason,service_start_date,requested_by_user_id,approved_by_user_id,approved_at,continuity_note) VALUES(1,$1,$2,$3,$4,'approved','Synthetic due approved transfer',$5,$6,$7,now(),'fictional tenant proof') RETURNING id",
    [secondWorker.id, secondaryEntity.id, primaryId, today, secondWorker.start_date, owner.id, checker.id]);
  const applied = status(await call(b, "PATCH", path,
    { organizationId: 1, id: due.id, action: "apply" }, secondaryEntity.id),
    200, "Independent checker may apply a due owned transfer");
  check(applied.data?.transfer?.status === "applied",
    "Apply must commit the exact due own transfer");
  const afterApply = await one(
    "SELECT legal_entity_id FROM employees WHERE id=$1 AND organization_id=1",
    [secondWorker.id]);
  check(afterApply.legal_entity_id === primaryId,
    "Due apply changes only owned employee legal employer");
  const assignment = await one(
    "SELECT legal_entity_id FROM employee_entity_assignments WHERE organization_id=1 AND employee_id=$1 AND effective_until IS NULL",
    [secondWorker.id]);
  check(assignment.legal_entity_id === primaryId,
    "New employer-of-record assignment is owned and current");


  // SECOND truly independent owning employer: employer C was only a group
  // reader in the shared browser fixture. Turn that fictional account into
  // its own actual company owner using PG16 membership and legal-entity
  // grants. This never changes production role policy or the route.
  const cMakerUser = await one("SELECT id FROM users WHERE email='entity-attacker-c@example.test'");
  await sql.query("UPDATE users SET role='owner' WHERE id=$1", [cMakerUser.id]);
  await sql.query(
    "UPDATE user_organizations SET role='owner' WHERE organization_id=3 AND user_id=$1",
    [cMakerUser.id]);
  const cWorker = await one(
    "SELECT id,organization_id,legal_entity_id FROM employees WHERE employee_no='C-01'");
  const cPrimary = await one(
    "SELECT id FROM legal_entities WHERE organization_id=3 AND code='PRIMARY'");
  const cSecondary = await one(
    "INSERT INTO legal_entities (organization_id,code,legal_name,display_name,primary_entity) VALUES(3,'CI-C-SECOND','Synthetic C alternate employer','C alternate',false) RETURNING id");
  const cCheckerUser = await one(
    "INSERT INTO users (email,name,role,password_hash,totp_enabled,active) SELECT 'entity-c-checker@example.test','Fictional C independent checker','admin',password_hash,false,true FROM users WHERE email='entity-checker@example.test' RETURNING id");
  await sql.query(
    "INSERT INTO user_organizations (user_id,organization_id,role,active) VALUES($1,3,'admin',true)",
    [cCheckerUser.id]);
  for (const [userId, entityId] of [
    [cMakerUser.id, cPrimary.id], [cMakerUser.id, cSecondary.id],
    [cCheckerUser.id, cPrimary.id], [cCheckerUser.id, cSecondary.id],
  ]) {
    await sql.query(
      "INSERT INTO user_legal_entity_grants (organization_id,user_id,legal_entity_id) VALUES(3,$1,$2)",
      [userId, entityId]);
  }
  check(cWorker.organization_id === 3 && cWorker.legal_entity_id === cPrimary.id,
    "A second genuinely independent employer has a persisted source worker");
  const cChecker = await login("entity-c-checker@example.test", "198.51.100.27");
  const cBody = () => ({
    organizationId: 3, employeeId: cWorker.id, toLegalEntityId: cSecondary.id,
    effectiveDate: future, reason: "Fictional tenant C owner transfer only",
  });
  const cProposed = status(await call(attackerC, "POST", path, cBody(), cPrimary.id),
    201, "Independent employer C must create a genuine own POST");
  const cOwnId = cProposed.data?.transfer?.id;
  const cOwnRow = await one(
    "SELECT organization_id,employee_id,status,requested_by_user_id FROM entity_transfer_requests WHERE id=$1",
    [cOwnId]);
  check(cOwnRow.organization_id === 3 && cOwnRow.employee_id === cWorker.id &&
    cOwnRow.status === "pending_approval" && cOwnRow.requested_by_user_id === cMakerUser.id,
    "C actual own HTTP POST must persist C maker and C worker");
  const cRejected = status(await call(cChecker, "PATCH", path,
    { organizationId: 3, id: cOwnId, action: "reject" }, cPrimary.id),
    200, "Independent employer C checker must reject its own transfer");
  check(cRejected.data?.transfer?.status === "rejected",
    "C independent PATCH reject persisted");
  const cProposedAgain = status(await call(attackerC, "POST", path, cBody(), cPrimary.id),
    201, "Independent employer C must POST another own transfer after rejection");
  const cOwnNextId = cProposedAgain.data?.transfer?.id;
  check(Number.isSafeInteger(cOwnNextId) && cOwnNextId > cOwnId,
    "Independent C second HTTP POST created a distinct real transfer");
  const cApproved = status(await call(cChecker, "PATCH", path,
    { organizationId: 3, id: cOwnNextId, action: "approve" }, cPrimary.id),
    200, "Independent employer C checker must approve its own transfer");
  check(cApproved.data?.transfer?.status === "approved",
    "C independent PATCH approve persisted");
  const cApprovedRow = await one(
    "SELECT organization_id,approved_by_user_id,status FROM entity_transfer_requests WHERE id=$1",
    [cOwnNextId]);
  check(cApprovedRow.organization_id === 3 && cApprovedRow.approved_by_user_id === cCheckerUser.id
    && cApprovedRow.status === "approved",
    "C reviewer and tenant are persisted, not merely echoed in HTTP");

  // HIGH-ID VICTIM INSERTED LAST, after A and C own POST/PATCH successes.
  // A fabricated missing ID is never used as a victim proof.
  const orderedVictimWorker = await one(
    "SELECT id,organization_id,legal_entity_id FROM employees WHERE employee_no='B-VICTIM-6'");
  const orderedVictim = await one(
    "INSERT INTO entity_transfer_requests(organization_id,employee_id,from_legal_entity_id,to_legal_entity_id,effective_date,status,reason,service_start_date,requested_by_user_id,continuity_note) VALUES(2,$1,$2,$3,$4,'pending_approval','Real higher-ID victim transfer','2026-01-01',$5,'synthetic immutable victim') RETURNING id",
    [orderedVictimWorker.id, victimEntity.id, victimSecondary.id, future, foreign.id]);
  check(orderedVictimWorker.organization_id === 2 && orderedVictimWorker.id > 6 &&
    orderedVictim.id > Math.max(6, ownId, nextId, due.id, cOwnId, cOwnNextId),
    "Real victim transfer ID >6 and strictly greater than both independent employers' own IDs");
  const newVictimBefore = await snapshot(2);
  check(newVictimBefore.entity_transfer_requests.some(row => row.id === orderedVictim.id),
    "The real higher-ID victim row is read back from PostgreSQL before attack");
  for (const [actor, orgId, source, selectorEntity] of [
    [a, 1, sourceWorker, primaryId],
    [attackerC, 3, cWorker, cPrimary.id],
  ]) {
    const beforeOwn = await snapshot(orgId);
    status(await call(actor, "PATCH", path,
      { organizationId: orgId, id: orderedVictim.id, action: "reject" }, selectorEntity),
      404, "Real higher-ID foreign transfer ID must look absent in own employer");
    status(await call(actor, "PATCH", path,
      { organizationId: 2, id: orderedVictim.id, action: "approve" }, victimEntity.id),
      403, "Forged actual victim employer selector must be rejected");
    status(await call(actor, "POST", path,
      { organizationId: orgId, employeeId: orderedVictimWorker.id,
        toLegalEntityId: orgId === 1 ? secondaryEntity.id : cSecondary.id,
        effectiveDate: future, reason: "Fictional forged real worker" }, selectorEntity),
      404, "Foreign real worker under own employer is denied");
    status(await call(actor, "POST", path,
      { organizationId: orgId, employeeId: source.id,
        toLegalEntityId: victimEntity.id, effectiveDate: future,
        reason: "Fictional forged legal-employer ID" }, selectorEntity),
      403, "Real victim legal employer cannot be selected by either attacker");
    assert.deepEqual(await snapshot(orgId), beforeOwn,
      "Denied victim transfer and forged selectors must not mutate the attacker's employer");
    assert.deepEqual(await snapshot(2), newVictimBefore,
      "Each denied victim ID or forged selector must leave victim transfer, people, payroll and audit SQL unchanged");
  }

  assert.deepEqual(await snapshot(2), newVictimBefore,
    "Foreign POST/PATCH, forged selectors and own decisions must leave victim transfers, workers, payroll and audit unchanged");
  const finished = await one(
    "SELECT status FROM entity_transfer_requests WHERE id=$1 AND organization_id=2", [victimMove.id]);
  check(finished.status === "pending_approval", "Victim pending transfer must remain untouched");
  console.log(JSON.stringify({
    kind: "tenant-multi-entity-transfer-write-PG16-http-candidate",
    methods: ["POST /api/multi-entity/transfers", "PATCH /api/multi-entity/transfers"],
    ownPost201: 4, independentEmployerOwnedPost201: 2,
    independentEmployerOwnedPatch200: 2,
    realVictimTransferIdAboveSixAndBothEmployers: true,
    ownPatchActions: ["reject", "approve", "apply"],
    foreignTenantDenials: 4, forgedSelectorsDenied: true,
    victimStateUnchanged: true, fictionalDataOnly: true,
    methodCredits: 0, independentlyAccepted: false,
    assertions: count,
  }));
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  await sql.end().catch(() => {});
}

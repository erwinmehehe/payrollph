/**
 * POST /api/workforce/worksites: every action (create_worksite, update_worksite, assign_employee, set_arrangement,
 * authorize_site, deny_site, end_authorization, configure_punch_photo, configure_geofence, disable_geofence) over
 * real production-mode localhost HTTP against a fresh fictional PostgreSQL 16 database.
 * Two independently authenticated attacker employers, a real higher-ID victim and a real non-allowlisted fourth employer.
 * Writes only worksite master data, assignments, arrangements, authorizations, site policies and audit rows. It never
 * creates shifts, punches, pay or provider traffic. ZERO manifest credits: the credit is a separate reviewed step.
 */
import assert from "node:assert/strict";
import {
  WORKSITES_ENDPOINT, WORKSITE_ACTIONS, requireDisposableWorksiteActions, assertWorksiteDenied, assertImmutableWorksiteSql,
} from "./tenant-worksites-actions-contract.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const tagOf = (e) => e.marker.split("-")[1];
const SNAPSHOT_TABLES = ["worksites", "employeeWorksiteAssignments", "hcmWorksiteAuthorizations", "hcmWorkArrangements",
  "worksitePunchPolicies", "worksiteGeofenceBoundaries", "employees"];

/** Proof logic. Takes the employers so a local disposable run and the CI fixture run execute the same code. */
export async function proveWorksiteActions({ attackers, victim, excluded, db, s, request, eq, asc, auditBusinessSnapshot }) {
  const subjects = [...attackers, victim, excluded];
  async function snapshot(orgId) {
    const out = {};
    for (const name of SNAPSHOT_TABLES) {
      const table = s[name];
      assert.ok(table?.organizationId, "required SQL table missing: " + name);
      out[name] = await db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id ?? table.worksiteId));
    }
    out.audit = auditBusinessSnapshot(await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, orgId)).orderBy(asc(s.auditEvents.id)));
    return plain(out);
  }
  const freezeAll = async () => new Map(await Promise.all(subjects.map(async (e) => [e.org.id, await snapshot(e.org.id)])));
  const unchanged = async (before, label) => {
    for (const e of subjects) assertImmutableWorksiteSql(before.get(e.org.id), await snapshot(e.org.id), label + " " + e.marker);
  };
  const post = (actor, body) => request(WORKSITES_ENDPOINT, { method: "POST", cookie: actor.cookie, body });
  const others = (actor) => subjects.filter((e) => e !== actor).map((e) => e.marker);

  /** A denied request must change nothing anywhere and leak no other employer's marker. */
  async function refused(actor, body, statuses, label) {
    const before = await freezeAll();
    assertWorksiteDenied(await post(actor, body), statuses, others(actor));
    await unchanged(before, label);
  }
  /** An allowed request must succeed, leave every other employer byte-identical, and return the own before/after. */
  async function allowed(actor, body, status, label) {
    const before = await freezeAll();
    const response = await post(actor, body);
    assert.equal(response.status, status, label + ": got " + response.status + " " + response.text.slice(0, 220));
    const after = await snapshot(actor.org.id);
    for (const other of subjects.filter((e) => e !== actor)) {
      assertImmutableWorksiteSql(before.get(other.org.id), await snapshot(other.org.id), label + " must not touch " + other.marker);
      assert.ok(!response.text.includes(other.marker), label + ": a success must not include another employer's data");
    }
    return { response, before: before.get(actor.org.id), after };
  }
  const keyOf = (row) => row.id ?? row.worksiteId;
  const addedRows = (before, after, table) => after[table].filter((row) => !before[table].some((old) => keyOf(old) === keyOf(row)));
  const onlyChanged = (before, after, allowedTables) => {
    for (const name of [...SNAPSHOT_TABLES, "audit"].filter((table) => !allowedTables.includes(table))) {
      assert.deepEqual(after[name], before[name], "this action may not change " + name);
    }
  };
  const receipt = (actor, before, after, action) => {
    const added = after.audit.filter((row) => !before.audit.some((old) => old.id === row.id));
    assert.deepEqual(after.audit.filter((row) => before.audit.some((old) => old.id === row.id)), before.audit, "earlier audit rows are unchanged");
    const matches = added.filter((row) => row.action === action);
    assert.equal(matches.length, 1, "exactly one audit receipt: " + action);
    for (const row of added) { assert.equal(row.organizationId, actor.org.id); assert.equal(row.actor, actor.owner.name); }
    return matches[0];
  };

  const nonce = Date.now().toString(36);
  async function seed(e) {
    const make = async (suffix) => (await db.insert(s.worksites).values({ organizationId: e.org.id, orgUnitId: e.unit.id,
      code: (tagOf(e) + "-" + suffix + "-" + nonce).slice(-30).toUpperCase(), name: e.marker + " fictional site " + suffix, siteType: "office",
      timezone: "Asia/Manila", active: true }).returning())[0];
    e.site1 = await make("S1");
    e.site2 = await make("S2");
    e.seedAuthorization = (await db.insert(s.hcmWorksiteAuthorizations).values({ organizationId: e.org.id, employeeId: e.worker.id, worksiteId: e.site2.id,
      decision: "allow", effectiveFrom: "2099-06-01", effectiveUntil: "2099-06-30", reason: e.marker + " fixture authorization",
      authorizedByUserId: e.owner.id, authorizedByName: e.owner.name }).returning())[0];
  }
  for (const e of subjects) await seed(e);
  assert.ok(victim.org.id > Math.max(...attackers.map((e) => e.org.id)) && victim.site1.id > Math.max(...attackers.map((e) => e.site1.id)) &&
    victim.worker.id > Math.max(...attackers.map((e) => e.worker.id)) && victim.seedAuthorization.id > Math.max(...attackers.map((e) => e.seedAuthorization.id)),
  "the victim's employer, worker, site and authorization must all exceed both attackers'");
  assert.ok(excluded.org.id > victim.org.id, "the excluded employer is a distinct persisted, non-allowlisted company");

  const summary = [];
  for (const actor of attackers) {
    const own = (extra) => ({ organizationId: actor.org.id, ...extra });
    const foreign = (extra) => ({ organizationId: victim.org.id, ...extra });

    // 1. create_worksite
    const createBody = (organizationId, code) => ({ organizationId, action: "create_worksite", code, name: actor.marker + " created site", siteType: "branch",
      timezone: "Asia/Manila", orgUnitId: organizationId === actor.org.id ? actor.unit.id : victim.unit.id, region: "NCR" });
    await refused(actor, createBody(victim.org.id, "FOREIGN-" + tagOf(actor) + nonce), 403, "victim employer create_worksite");
    await refused(actor, { ...createBody(actor.org.id, "FORGED-" + tagOf(actor) + nonce), orgUnitId: victim.unit.id }, 422, "forged victim org unit create_worksite");
    let r = await allowed(actor, createBody(actor.org.id, "NEW-" + tagOf(actor) + nonce), 201, "own create_worksite");
    const created = addedRows(r.before, r.after, "worksites");
    assert.equal(created.length, 1, "exactly one worksite is created");
    assert.equal(created[0].organizationId, actor.org.id); assert.equal(created[0].orgUnitId, actor.unit.id); assert.equal(created[0].active, true);
    assert.equal(r.response.json?.worksite?.id, created[0].id);
    onlyChanged(r.before, r.after, ["worksites", "audit"]); receipt(actor, r.before, r.after, "Worksite created");

    // 2. assign_employee
    const assignBody = (organizationId, employeeId, worksiteId) => ({ organizationId, action: "assign_employee", employeeId, worksiteId, effectiveFrom: "2099-01-01", reason: actor.marker + " assignment" });
    await refused(actor, assignBody(actor.org.id, victim.worker.id, actor.site1.id), 404, "forged victim worker assign_employee");
    await refused(actor, assignBody(actor.org.id, actor.worker.id, victim.site1.id), 404, "forged victim site assign_employee");
    await refused(actor, assignBody(victim.org.id, victim.worker.id, victim.site1.id), 403, "victim employer assign_employee");
    r = await allowed(actor, assignBody(actor.org.id, actor.worker.id, actor.site1.id), 201, "own assign_employee");
    const assigned = addedRows(r.before, r.after, "employeeWorksiteAssignments");
    assert.equal(assigned.length, 1); assert.equal(assigned[0].organizationId, actor.org.id); assert.equal(assigned[0].employeeId, actor.worker.id); assert.equal(assigned[0].worksiteId, actor.site1.id);
    assert.equal(r.response.json?.assignment?.id, assigned[0].id);
    receipt(actor, r.before, r.after, "Employee worksite assigned");

    // 3. set_arrangement
    const arrangementBody = (organizationId, employeeId) => ({ organizationId, action: "set_arrangement", employeeId, mode: "hybrid", effectiveFrom: "2099-02-01", reason: actor.marker + " arrangement" });
    await refused(actor, arrangementBody(actor.org.id, victim.worker.id), 404, "forged victim worker set_arrangement");
    await refused(actor, arrangementBody(victim.org.id, victim.worker.id), 403, "victim employer set_arrangement");
    r = await allowed(actor, arrangementBody(actor.org.id, actor.worker.id), 201, "own set_arrangement");
    const arranged = addedRows(r.before, r.after, "hcmWorkArrangements");
    assert.equal(arranged.length, 1); assert.equal(arranged[0].organizationId, actor.org.id); assert.equal(arranged[0].employeeId, actor.worker.id); assert.equal(arranged[0].mode, "hybrid");
    assert.equal(arranged[0].createdByUserId, actor.owner.id); assert.equal(r.response.json?.arrangement?.id, arranged[0].id);
    onlyChanged(r.before, r.after, ["hcmWorkArrangements", "audit"]); receipt(actor, r.before, r.after, "HCM work arrangement set");

    // 4. authorize_site (a secondary site) and 5. deny_site (a dated restriction)
    const accessBody = (action, organizationId, employeeId, worksiteId, from, until) => ({ organizationId, action, employeeId, worksiteId, effectiveFrom: from, effectiveUntil: until, reason: actor.marker + " " + action });
    for (const action of ["authorize_site", "deny_site"]) {
      await refused(actor, accessBody(action, actor.org.id, victim.worker.id, actor.site2.id, "2099-08-01", "2099-08-31"), 404, "forged victim worker " + action);
      await refused(actor, accessBody(action, actor.org.id, actor.worker.id, victim.site2.id, "2099-08-01", "2099-08-31"), 404, "forged victim site " + action);
      await refused(actor, accessBody(action, victim.org.id, victim.worker.id, victim.site2.id, "2099-08-01", "2099-08-31"), 403, "victim employer " + action);
    }
    r = await allowed(actor, accessBody("authorize_site", actor.org.id, actor.worker.id, actor.site2.id, "2099-08-01", "2099-08-31"), 201, "own authorize_site");
    const authorized = addedRows(r.before, r.after, "hcmWorksiteAuthorizations");
    assert.equal(authorized.length, 1); assert.equal(authorized[0].decision, "allow"); assert.equal(authorized[0].organizationId, actor.org.id);
    assert.equal(authorized[0].employeeId, actor.worker.id); assert.equal(authorized[0].worksiteId, actor.site2.id); assert.equal(authorized[0].authorizedByUserId, actor.owner.id);
    onlyChanged(r.before, r.after, ["hcmWorksiteAuthorizations", "audit"]); receipt(actor, r.before, r.after, "HCM secondary worksite authorized");
    const authorization = authorized[0];
    r = await allowed(actor, accessBody("deny_site", actor.org.id, actor.worker.id, actor.site1.id, "2099-09-01", "2099-09-30"), 201, "own deny_site");
    const denied = addedRows(r.before, r.after, "hcmWorksiteAuthorizations");
    assert.equal(denied.length, 1); assert.equal(denied[0].decision, "deny"); assert.equal(denied[0].organizationId, actor.org.id); assert.equal(denied[0].worksiteId, actor.site1.id);
    onlyChanged(r.before, r.after, ["hcmWorksiteAuthorizations", "audit"]); receipt(actor, r.before, r.after, "HCM worksite restricted");

    // 6. end_authorization
    const endBody = (organizationId, employeeId, authorizationId) => ({ organizationId, action: "end_authorization", employeeId, authorizationId, endDate: "2099-06-15" });
    await refused(actor, endBody(actor.org.id, victim.worker.id, victim.seedAuthorization.id), 404, "forged victim worker end_authorization");
    await refused(actor, endBody(actor.org.id, actor.worker.id, victim.seedAuthorization.id), 409, "forged victim authorization end_authorization");
    await refused(actor, endBody(victim.org.id, victim.worker.id, victim.seedAuthorization.id), 403, "victim employer end_authorization");
    r = await allowed(actor, { organizationId: actor.org.id, action: "end_authorization", employeeId: actor.worker.id, authorizationId: authorization.id, endDate: "2099-08-15" }, 200, "own end_authorization");
    const ended = r.after.hcmWorksiteAuthorizations.find((row) => row.id === authorization.id);
    assert.equal(ended.effectiveUntil, "2099-08-15"); assert.equal(r.response.json?.authorization?.id, authorization.id);
    assert.deepEqual(r.after.hcmWorksiteAuthorizations.filter((row) => row.id !== authorization.id), r.before.hcmWorksiteAuthorizations.filter((row) => row.id !== authorization.id));
    onlyChanged(r.before, r.after, ["hcmWorksiteAuthorizations", "audit"]); receipt(actor, r.before, r.after, "HCM secondary worksite authorization ended");

    // 7. configure_punch_photo (pilot-gated: the excluded employer gets 404, never a write)
    const photoBody = (organizationId, worksiteId) => ({ organizationId, action: "configure_punch_photo", worksiteId, photoMode: "optional", reason: actor.marker + " selfie policy" });
    await refused(actor, photoBody(actor.org.id, victim.site1.id), 404, "forged victim site configure_punch_photo");
    await refused(actor, photoBody(victim.org.id, victim.site1.id), 403, "victim employer configure_punch_photo");
    await refused(excluded, { organizationId: excluded.org.id, action: "configure_punch_photo", worksiteId: excluded.site1.id, photoMode: "optional", reason: excluded.marker + " pilot off" }, 404, "non-allowlisted employer configure_punch_photo");
    r = await allowed(actor, photoBody(actor.org.id, actor.site1.id), 200, "own configure_punch_photo");
    const policies = addedRows(r.before, r.after, "worksitePunchPolicies");
    assert.equal(policies.length, 1); assert.equal(policies[0].organizationId, actor.org.id); assert.equal(policies[0].worksiteId, actor.site1.id);
    assert.equal(policies[0].photoMode, "optional"); assert.equal(policies[0].updatedByUserId, actor.owner.id);
    assert.deepEqual(r.response.json, { ok: true, worksiteId: actor.site1.id, photoMode: "optional" });
    onlyChanged(r.before, r.after, ["worksitePunchPolicies", "audit"]); receipt(actor, r.before, r.after, "Worksite selfie policy changed");

    // 8. configure_geofence and 9. disable_geofence
    const fenceBody = (action, organizationId, worksiteId) => ({ organizationId, action, worksiteId, reason: actor.marker + " " + action,
      ...(action === "configure_geofence" ? { latitude: 14.5995, longitude: 120.9842, radiusMeters: 300 } : {}) });
    for (const action of ["configure_geofence", "disable_geofence"]) {
      await refused(actor, fenceBody(action, actor.org.id, victim.site1.id), 404, "forged victim site " + action);
      await refused(actor, fenceBody(action, victim.org.id, victim.site1.id), 403, "victim employer " + action);
      await refused(excluded, fenceBody(action, excluded.org.id, excluded.site1.id), 404, "non-allowlisted employer " + action);
    }
    r = await allowed(actor, fenceBody("configure_geofence", actor.org.id, actor.site1.id), 200, "own configure_geofence");
    const fences = addedRows(r.before, r.after, "worksiteGeofenceBoundaries");
    assert.equal(fences.length, 1); assert.equal(fences[0].organizationId, actor.org.id); assert.equal(fences[0].worksiteId, actor.site1.id); assert.equal(fences[0].radiusMeters, 300);
    assert.deepEqual(r.response.json?.worksite, { id: actor.site1.id, geofenceConfigured: true, geofenceRadiusM: 300 });
    onlyChanged(r.before, r.after, ["worksiteGeofenceBoundaries", "audit"]);
    assert.equal(receipt(actor, r.before, r.after, "Worksite geofence configured").metadata.newConfigured, true);
    r = await allowed(actor, fenceBody("disable_geofence", actor.org.id, actor.site1.id), 200, "own disable_geofence");
    assert.equal(r.after.worksiteGeofenceBoundaries.length, r.before.worksiteGeofenceBoundaries.length - 1, "exactly the own boundary is removed");
    assert.equal(r.after.worksiteGeofenceBoundaries.some((row) => row.worksiteId === actor.site1.id), false);
    assert.deepEqual(r.response.json?.worksite, { id: actor.site1.id, geofenceConfigured: false, geofenceRadiusM: null });
    onlyChanged(r.before, r.after, ["worksiteGeofenceBoundaries", "audit"]);
    assert.equal(receipt(actor, r.before, r.after, "Worksite geofence disabled").metadata.previousConfigured, true);

    // 10. update_worksite: rename and region on the assigned site; deactivate the unused one; a used site cannot be deactivated.
    const updateBody = (organizationId, worksiteId, extra) => ({ organizationId, action: "update_worksite", worksiteId, ...extra });
    await refused(actor, updateBody(actor.org.id, victim.site1.id, { name: actor.marker + " stolen" }), 404, "forged victim site update_worksite");
    await refused(actor, updateBody(victim.org.id, victim.site1.id, { name: actor.marker + " stolen" }), 403, "victim employer update_worksite");
    await refused(actor, updateBody(actor.org.id, actor.site1.id, { active: false }), 409, "deactivating a site with a current assignment");
    r = await allowed(actor, updateBody(actor.org.id, actor.site1.id, { name: actor.marker + " renamed site", region: "CALABARZON" }), 200, "own update_worksite rename");
    const renamed = r.after.worksites.find((row) => row.id === actor.site1.id);
    assert.equal(renamed.name, actor.marker + " renamed site"); assert.equal(renamed.region, "CALABARZON"); assert.equal(renamed.active, true);
    assert.deepEqual(r.after.worksites.filter((row) => row.id !== actor.site1.id), r.before.worksites.filter((row) => row.id !== actor.site1.id));
    onlyChanged(r.before, r.after, ["worksites", "audit"]); receipt(actor, r.before, r.after, "Worksite updated");
    r = await allowed(actor, updateBody(actor.org.id, actor.site2.id, { active: false }), 200, "own update_worksite deactivate");
    assert.equal(r.after.worksites.find((row) => row.id === actor.site2.id).active, false);
    onlyChanged(r.before, r.after, ["worksites", "audit"]); receipt(actor, r.before, r.after, "Worksite updated");
    summary.push(tagOf(actor));
  }
  return { actions: WORKSITE_ACTIONS, attackers: summary, victimEmployerDenials: true, nonAllowlistedEmployerDenials: 3 };
}

async function main() {
  // Mandatory fail-closed validation precedes every database / application import.
  requireDisposableWorksiteActions();
  const [database, s, drizzle, helpers, guards] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"), import("drizzle-orm"),
    import("./tenant-table-http.mjs"), import("./tenant-table-invariants.mjs"),
  ]);
  const { db, pool } = database;
  try {
    const version = await pool.query("show server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000), 16);
    const [victim, a, b] = guards.readAllowlistPreseed(process.env.TENANT_TABLE_ALLOWLIST_FIXTURE);
    const excluded = guards.readPrivateAllowlistFixture(process.env.TENANT_TABLE_ALLOWLIST_FIXTURE).excluded;
    assert.equal((await db.select({ id: s.hcmWorksiteAuthorizations.id }).from(s.hcmWorksiteAuthorizations).limit(1)).length, 0,
      "only an unmodified disposable authorization store may be used");
    const result = await proveWorksiteActions({ attackers: [a, b], victim, excluded, db, s, request: helpers.standaloneRequest,
      eq: drizzle.eq, asc: drizzle.asc, auditBusinessSnapshot: guards.auditBusinessSnapshot });
    console.log("FICTIONAL_WORKSITE_ACTIONS_PASS: " + JSON.stringify(result) + "; ZERO NEW METHOD CREDITS");
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-worksites-actions-http.mjs")) {
  main().catch((error) => { console.error("FICTIONAL_WORKSITE_ACTIONS_FAIL:", error.message); process.exitCode = 1; });
}

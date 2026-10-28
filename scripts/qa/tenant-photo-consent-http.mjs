/**
 * Fictional PostgreSQL 16 + authenticated localhost HTTP proof for
 * POST /api/web-bundy/consent. Two independent employee attackers, one
 * genuine higher-ID victim, one intentionally unallowlisted employer.
 *
 * --bootstrap runs BEFORE Next starts and exports only actual inserted
 * employer IDs to GITHUB_ENV. The unpredictable private 0600 fixture stores
 * fictional session cookies off logs. --prove runs after localhost is ready.
 * Neither mode is allowed against production, staging or customer data.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, constants, fstatSync, mkdtempSync,
  openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONSENT_FIXTURE_SCHEMA, CONSENT_VERSION, requireDisposableConsentTarget,
  assertOwnedConsentReceipt, assertConsentRefused,
} from "./tenant-photo-consent-contract.mjs";

const PATH = "/api/web-bundy/consent";
const jsonCopy = value => JSON.parse(JSON.stringify(value));

// The cross-origin probe must not transmit anything read from the private
// fixture file. Select its synthetic identity from the guarded database and
// mint a fresh in-memory session, then use a literal localhost destination.
export async function crossSiteConsentProbe({ readActor, readWorker, makeSession, request, fetcher = fetch }) {
  const actor = await readActor();
  assert.ok(Number.isSafeInteger(actor?.id) && actor.id > 0);
  assert.ok(Number.isSafeInteger(actor.employeeId) && actor.employeeId > 0);
  const worker = await readWorker(actor.employeeId);
  assert.equal(worker?.id, actor.employeeId);
  assert.ok(Number.isSafeInteger(worker.organizationId) && worker.organizationId > 0);
  const session = await makeSession(actor.id);
  assert.match(session.cookie, /^__Host-linaw_session=[a-f0-9]{64}$/);
  const authenticated = await request("/api/auth/me", { cookie: session.cookie });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.json?.user?.id, actor.id);
  assert.equal(authenticated.json.user.role, "employee");
  assert.equal(authenticated.json.user.employeeId, worker.id);
  const body = { organizationId: worker.organizationId, choice: "accepted" };
  const sameOrigin = await request(PATH, { method: "POST", cookie: session.cookie, body });
  assertOwnedConsentReceipt(sameOrigin, "accepted", "unchanged");
  const response = await fetcher("http://127.0.0.1:3000/api/web-bundy/consent", {
    method: "POST", redirect: "manual", cache: "no-store",
    headers: { cookie: session.cookie, "content-type": "application/json",
      origin: "https://hostile.example.invalid", "sec-fetch-site": "cross-site" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json, headers: response.headers };
}

function readPrivateFixture(path) {
  assert.match(path ?? "", /^\/tmp\/payrollph-photo-consent-[A-Za-z0-9]{6}\/fixture\.json$/);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    assert.ok(info.isFile() && info.nlink === 1 && (info.mode & 0o777) === 0o600,
      "private fictional cookie fixture must be single-link mode 0600");
    if (typeof process.getuid === "function")
      assert.equal(info.uid, process.getuid(), "private fixture owner");
    assert.ok(info.size > 0 && info.size < 32768, "bounded private fixture required");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}

function safeEmployer(e, employeeActor, pictures) {
  return {
    org: { id: e.org.id }, entity: { id: e.entity.id },
    unit: { id: e.unit.id }, worker: { id: e.worker.id },
    marker: e.marker,
    owner: { id: e.owner.id, cookie: e.cookie },
    actor: { id: employeeActor.id, cookie: employeeActor.cookie },
    photoIds: pictures.map(p => p.id),
  };
}

async function bootstrap() {
  requireDisposableConsentTarget(process.env, "bootstrap");
  const [{ db, pool }, schema, orm, shared] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const { eq } = orm;
  const { organizations, auditEvents, users, userOrganizations,
    workforcePunchPhotoEvidence } = schema;
  const { seedEmployer, addWorker, standaloneMakeSession, requireTenantTableDisposable } = shared;
  requireTenantTableDisposable();

  try {
    assert.equal((await db.select({ id: organizations.id }).from(organizations).limit(1)).length, 0,
      "PHOTO_CONSENT_REFUSED: a genuinely empty disposable employer table is required");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).limit(1)).length, 0,
      "PHOTO_CONSENT_REFUSED: empty audit source is required");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM", "UNLISTED"]) {
      employers.push(await seedEmployer(label, nonce, standaloneMakeSession));
    }
    const [a, b, victim, unlisted] = employers;
    for (const field of ["org", "entity", "unit", "worker", "owner"]) {
      assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
        "the victim " + field + " ID must be genuinely higher");
      assert.ok(unlisted[field].id > victim[field].id,
        "an independently real fourth employer must remain unallowlisted");
    }
    const serialized = [];
    for (const e of employers) {
      const [user] = await db.insert(users).values({
        name: "Fictional photo-consent employee " + e.marker,
        email: "photo-consent-" + randomUUID() + "@example.invalid",
        passwordHash: "synthetic-no-password-login",
        role: "employee", employeeId: e.worker.id, active: true,
      }).returning({ id: users.id });
      await db.insert(userOrganizations).values({
        userId: user.id, organizationId: e.org.id,
        role: "employee", active: true, workerEmployeeId: e.worker.id,
      });
      const actorSession = await standaloneMakeSession(user.id);
      const expiresAt = new Date(Date.now() + 30 * 86_400_000);
      const pictures = await db.insert(workforcePunchPhotoEvidence).values([
        { id: randomUUID(), organizationId: e.org.id,
          employeeId: e.worker.id, sealedPhoto: e.marker + "-NONHELD-FAKE",
          legalHold: false, expiresAt },
        { id: randomUUID(), organizationId: e.org.id,
          employeeId: e.worker.id, sealedPhoto: e.marker + "-HELD-FAKE",
          legalHold: true, expiresAt },
      ]).returning();
      assert.equal(pictures.length, 2);
      assert.ok(pictures.every(p => p.organizationId === e.org.id
        && p.employeeId === e.worker.id));
      serialized.push(safeEmployer(e, { id: user.id, cookie: actorSession.cookie }, pictures));
    }

    // A first-time refusal is a distinct supported consent action from
    // ACCEPTED -> DECLINED withdrawal. Create actual independently linked
    // employee accounts for A and B, but seed NO photo evidence for them:
    // a first-time decline cannot retroactively authorize photo capture.
    // These actors will mint fresh sessions in --prove, not store cookies in
    // the private fixture or transmit fixture-derived cookies via raw fetch.
    const firstDeclines = [];
    for (const e of [a, b]) {
      const peer = await addWorker(e, "FIRST-DECLINE", { payProfile: false });
      const [actor] = await db.insert(users).values({
        name: "Fictional initial photo refusal " + e.marker,
        email: "initial-photo-refusal-" + randomUUID() + "@example.invalid",
        passwordHash: "synthetic-no-password-login",
        role: "employee", employeeId: peer.id, active: true,
      }).returning({ id: users.id });
      await db.insert(userOrganizations).values({
        userId: actor.id, organizationId: e.org.id,
        role: "employee", active: true, workerEmployeeId: peer.id,
      });
      firstDeclines.push({
        organizationId: e.org.id, employeeId: peer.id, userId: actor.id,
      });
    }

    // Malformed-identity control: a signed-in employee has actual membership
    // in A, but the user.employeeId points to the victim's real worker. The
    // employee/org binding MUST independently reject this as 404, not record
    // or withdraw the victim's consent.
    const [misbound] = await db.insert(users).values({
      name: "Fictional mismatched employee " + a.marker,
      email: "photo-mismatch-" + randomUUID() + "@example.invalid",
      passwordHash: "synthetic-no-password-login",
      role: "employee", employeeId: victim.worker.id, active: true,
    }).returning({ id: users.id });
    await db.insert(userOrganizations).values({
      userId: misbound.id, organizationId: a.org.id,
      role: "employee", active: true,
    });
    const mismatchedSession = await standaloneMakeSession(misbound.id);

    const enabledIds = [a.org.id, b.org.id, victim.org.id];
    assert.ok(enabledIds.every(id => Number.isSafeInteger(id) && id > 0
      && id < 2_147_483_648));
    assert.ok(!enabledIds.includes(unlisted.org.id));
    assert.ok(enabledIds.join(",").length < 240);
    const fixture = {
      schema: CONSENT_FIXTURE_SCHEMA,
      employers: serialized,
      allowlistedIds: enabledIds,
      firstDeclines,
      mismatch: { userId: misbound.id, cookie: mismatchedSession.cookie },
    };
    const directory = mkdtempSync(join(tmpdir(), "payrollph-photo-consent-"));
    const file = join(directory, "fixture.json");
    writeFileSync(file, JSON.stringify(fixture), {
      encoding: "utf8", flag: "wx", mode: 0o600,
    });
    appendFileSync(process.env.GITHUB_ENV,
      "WFM_PUNCH_EVIDENCE_ORG_IDS=" + enabledIds.join(",") + "\n");
    appendFileSync(process.env.GITHUB_ENV, "PHOTO_CONSENT_FIXTURE=" + file + "\n");
    console.log(JSON.stringify({
      kind: "tenant-photo-consent-bootstrap", seededEmployers: 4,
      explicitlyAllowlisted: 3, realHigherIdVictim: true,
      nonallowlistedEmployer: 1, syntheticPhotoEvidence: 8,
      initialRefusalActors: firstDeclines.length,
      cookieValuesLogged: false, productionTested: false, credits: 0,
    }));
  } finally {
    await pool.end();
  }
}

async function prove() {
  requireDisposableConsentTarget(process.env, "prove");
  const fixture = readPrivateFixture(process.env.PHOTO_CONSENT_FIXTURE);
  assert.equal(fixture.schema, CONSENT_FIXTURE_SCHEMA);
  assert.equal(fixture.employers?.length, 4);
  const [a, b, victim, excluded] = fixture.employers;
  assert.deepEqual(fixture.firstDeclines?.map(p => p.organizationId),
    [a.org.id, b.org.id], "first-refusal employees must belong to separate real employers");
  assert.deepEqual(fixture.allowlistedIds,
    [a.org.id, b.org.id, victim.org.id]);
  assert.equal(process.env.WFM_PUNCH_EVIDENCE_ORG_IDS,
    fixture.allowlistedIds.join(","));
  for (const e of fixture.employers) {
    assert.ok(e.marker.startsWith("TTBL-"));
    assert.match(e.actor.cookie, /^__Host-linaw_session=[a-f0-9]{64}$/);
    assert.match(e.owner.cookie, /^__Host-linaw_session=[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(e.org.id) && Number.isSafeInteger(e.worker.id)
      && Number.isSafeInteger(e.actor.id));
    assert.equal(e.photoIds.length, 2);
  }
  assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
  assert.ok(victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);
  assert.ok(excluded.org.id > victim.org.id);
  assert.match(fixture.mismatch.cookie, /^__Host-linaw_session=[a-f0-9]{64}$/);

  const [{ db, pool }, schema, orm, shared, invariants] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const { eq, inArray } = orm;
  const { organizations, employees, employeePayProfiles, auditEvents,
    workforcePunchPhotoConsents, workforcePunchPhotoEvidence,
    workforcePunchSubmissions, timePunches, attendanceCorrectionRequests,
    payrollRuns, payrollEntries, payoutBatches, users } = schema;
  const { standaloneRequest, requireTenantTableDisposable } = shared;
  requireTenantTableDisposable();

  async function state(e) {
    const selectOrg = table => db.select().from(table)
      .where(eq(table.organizationId, e.org.id)).orderBy(table.id);
    const [org, staff, profiles, consent, photos, audits, submissions, punches,
      corrections, runs, payouts] = await Promise.all([
        db.select().from(organizations).where(eq(organizations.id, e.org.id)),
        selectOrg(employees), selectOrg(employeePayProfiles),
        selectOrg(workforcePunchPhotoConsents),
        selectOrg(workforcePunchPhotoEvidence), selectOrg(auditEvents),
        selectOrg(workforcePunchSubmissions), selectOrg(timePunches),
        selectOrg(attendanceCorrectionRequests), selectOrg(payrollRuns),
        selectOrg(payoutBatches),
      ]);
    const entries = runs.length ? await db.select().from(payrollEntries)
      .where(inArray(payrollEntries.payrollRunId, runs.map(run => run.id)))
      .orderBy(payrollEntries.id) : [];
    return jsonCopy({ org, staff, profiles, consent, photos,
      audits: invariants.auditBusinessSnapshot(audits),
      submissions, punches, corrections, runs, entries, payouts });
  }
  function assertOtherSourcesPreserved(before, after, label, { photoWithdrawal = false } = {}) {
    // Withdrawal is the ONLY operation permitted to purge non-held image
    // evidence. Validate that exact per-row difference separately, while
    // keeping every other attendance and payroll source byte-identical.
    const permitted = new Set(["consent", "audits",
      ...(photoWithdrawal ? ["photos"] : [])]);
    for (const key of Object.keys(before).filter(k => !permitted.has(k))) {
      assert.deepEqual(after[key], before[key],
        label + ": unrelated " + key + " records must remain unchanged");
    }
  }
  async function ledger() {
    return jsonCopy({
      punches: await db.select().from(timePunches).orderBy(timePunches.id),
      submissions: await db.select().from(workforcePunchSubmissions)
        .orderBy(workforcePunchSubmissions.id),
      corrections: await db.select().from(attendanceCorrectionRequests)
        .orderBy(attendanceCorrectionRequests.id),
      payrollRuns: await db.select().from(payrollRuns).orderBy(payrollRuns.id),
      payrollEntries: await db.select().from(payrollEntries).orderBy(payrollEntries.id),
      payoutBatches: await db.select().from(payoutBatches).orderBy(payoutBatches.id),
    });
  }
  async function post(cookie, organizationId, choice) {
    return standaloneRequest(PATH, {
      method: "POST", cookie, body: { organizationId, choice },
    });
  }
  const protectedMarkers = fixture.employers.flatMap(e =>
    [e.marker, e.marker + "-NONHELD-FAKE", e.marker + "-HELD-FAKE"]);
  let positive = 0, rejected = 0;
  async function denied(cookie, org, choice, status) {
    const response = await post(cookie, org, choice);
    assertConsentRefused(response, status, protectedMarkers);
    rejected++;
    return response;
  }
  try {
    const initialLedger = await ledger();
    for (const e of fixture.employers) {
      const s = await state(e);
      assert.equal(s.consent.length, 0,
        "the initial consent must be established by real signed-in HTTP, not a seeded fake");
      assert.equal(s.photos.length, 2);
      assert.deepEqual(s.photos.map(p => p.id).sort(), [...e.photoIds].sort(),
        "photo IDs are checked as a set; PostgreSQL sorts UUID keys, not insert order");
      assert.equal(s.photos.filter(p => p.legalHold).length, 1);
      assert.ok(s.photos.every(p => p.sealedPhoto?.includes(e.marker) && p.purgedAt == null));
    }

    // Independent actual POST successes from BOTH attackers and the higher-ID
    // victim; identity and audit source is read back from PG, not response alone.
    for (const e of [a, b, victim]) {
      const before = await state(e);
      const response = await post(e.actor.cookie, e.org.id, "accepted");
      assertOwnedConsentReceipt(response, "accepted", "recorded");
      const after = await state(e);
      assert.equal(after.consent.length, 1);
      const row = after.consent[0];
      assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
      assert.equal(row.organizationId, e.org.id);
      assert.equal(row.employeeId, e.worker.id);
      assert.equal(row.decidedByUserId, e.actor.id);
      assert.equal(row.consentVersion, CONSENT_VERSION);
      assert.equal(row.choice, "accepted");
      assert.equal(after.audits.length, before.audits.length + 1);
      assert.equal(after.audits.at(-1).action, "WFM selfie consent recorded");
      assert.equal(after.audits.at(-1).metadata.employeeId, e.worker.id);
      assert.equal(after.audits.at(-1).metadata.choice, "accepted");
      assertOtherSourcesPreserved(before, after, "own consent recording " + e.marker);
      positive++;
    }
    // A never-accepted employee may decline immediately. Distinguish this
    // legitimate 200 + persisted consent/audit from the later withdrawal
    // branch. No photo was ever captured for these employees.
    let initialRefusals = 0;
    for (const peer of fixture.firstDeclines) {
      const e = [a, b].find(row => row.org.id === peer.organizationId);
      assert.ok(e);
      const before = await state(e);
      assert.ok(before.staff.some(worker => worker.id === peer.employeeId));
      assert.equal(before.consent.filter(c => c.employeeId === peer.employeeId).length, 0);
      assert.equal(before.photos.filter(photo => photo.employeeId === peer.employeeId).length, 0,
        "never-consented peer must have no seeded/captured photographs");
      const session = await shared.standaloneMakeSession(peer.userId);
      assertOwnedConsentReceipt(await post(session.cookie, peer.organizationId, "declined"),
        "declined", "recorded");
      const after = await state(e);
      const own = after.consent.filter(c => c.employeeId === peer.employeeId);
      assert.equal(own.length, 1, "first refusal must persist exactly one own consent");
      assert.equal(own[0].organizationId, e.org.id);
      assert.equal(own[0].decidedByUserId, peer.userId);
      assert.equal(own[0].consentVersion, CONSENT_VERSION);
      assert.equal(own[0].choice, "declined");
      assert.equal(after.audits.length, before.audits.length + 1);
      assert.equal(after.audits.at(-1).metadata.employeeId, peer.employeeId);
      assert.equal(after.audits.at(-1).metadata.choice, "declined");
      assertOtherSourcesPreserved(before, after, "first-time consent refusal " + e.marker);
      assert.equal(after.photos.filter(photo => photo.employeeId === peer.employeeId).length, 0);
      const unchanged = await state(e);
      assertOwnedConsentReceipt(await post(session.cookie, peer.organizationId, "declined"),
        "declined", "unchanged");
      assert.deepEqual(await state(e), unchanged, "repeat refusal cannot add consent/audit");
      await denied(session.cookie, peer.organizationId, "accepted", 409);
      assert.deepEqual(await state(e), unchanged,
        "refusing then attempting silent reacceptance must not modify employer state");
      initialRefusals++;
      positive++;
    }
    assert.equal(initialRefusals, 2);
    const ownStates = await Promise.all(fixture.employers.map(state));

    // Attacker A and B must not write to the real victim or each other.
    for (const [attacker, other] of [[a, b], [b, a]]) {
      await denied(attacker.actor.cookie, victim.org.id, "declined", 403);
      await denied(attacker.actor.cookie, other.org.id, "declined", 403);
      await denied(attacker.owner.cookie, attacker.org.id, "declined", 403);
    }
    await denied(undefined, a.org.id, "accepted", 403);
    await denied(a.actor.cookie, a.org.id, "invalid-choice", 400);
    await denied(a.actor.cookie, 0, "declined", 400);
    const crossSite = await crossSiteConsentProbe({
      readActor: async () => (await db.select({ id: users.id, employeeId: users.employeeId })
        .from(users).where(eq(users.role, "employee")).orderBy(users.id).limit(1))[0],
      readWorker: async id => (await db.select({ id: employees.id, organizationId: employees.organizationId })
        .from(employees).where(eq(employees.id, id)).limit(1))[0],
      makeSession: shared.standaloneMakeSession,
      request: standaloneRequest,
    });
    assertConsentRefused(crossSite, 403, protectedMarkers);
    rejected++;
    // An employee in A whose actual user.employeeId points to a victim row
    // must NOT create A consent nor access victim via a forged membership.
    await denied(fixture.mismatch.cookie, a.org.id, "declined", 404);
    await denied(fixture.mismatch.cookie, victim.org.id, "declined", 403);
    await denied(excluded.actor.cookie, excluded.org.id, "accepted", 404);
    await denied(a.actor.cookie, excluded.org.id, "declined", 404);

    const afterDenials = await Promise.all(fixture.employers.map(state));
    for (let i = 0; i < ownStates.length; i++) {
      assert.deepEqual(afterDenials[i], ownStates[i],
        "foreign, forged, nonallowlisted and role failures must write NO source rows");
    }

    for (const e of [a, b]) {
      // Confirm actual recorded receipt is idempotent, with no second audit.
      const beforeRepeat = await state(e);
      assertOwnedConsentReceipt(await post(e.actor.cookie, e.org.id, "accepted"),
        "accepted", "unchanged");
      assert.deepEqual(await state(e), beforeRepeat,
        "same consent must not issue another audit");
      const before = await state(e);
      assertOwnedConsentReceipt(await post(e.actor.cookie, e.org.id, "declined"),
        "declined", "recorded");
      const after = await state(e);
      assert.equal(after.consent.length, 1);
      assert.equal(after.consent[0].id, before.consent[0].id);
      assert.equal(after.consent[0].choice, "declined");
      assert.equal(after.consent[0].decidedByUserId, e.actor.id);
      assert.equal(after.audits.length, before.audits.length + 1);
      assert.equal(after.audits.at(-1).action, "WFM selfie consent withdrawn");
      assert.equal(after.audits.at(-1).metadata.choice, "declined");
      const nonheld = after.photos.find(photo => !photo.legalHold);
      const held = after.photos.find(photo => photo.legalHold);
      const beforeNonheld = before.photos.find(photo => !photo.legalHold);
      const beforeHeld = before.photos.find(photo => photo.legalHold);
      assert.equal(nonheld.id, beforeNonheld.id);
      assert.equal(nonheld.sealedPhoto, null,
        "revoking consent must purge existing non-held photo evidence");
      assert.ok(nonheld.purgedAt,
        "purge must write the actual timestamp");
      assert.deepEqual({
        ...nonheld,
        sealedPhoto: beforeNonheld.sealedPhoto,
        purgedAt: beforeNonheld.purgedAt,
      }, beforeNonheld, "withdrawal may change only ciphertext and purge time");
      assert.deepEqual(held, beforeHeld,
        "legal-hold photo must stay byte-identical under withdrawal");
      assertOtherSourcesPreserved(before, after,
        "own consent withdrawal " + e.marker, { photoWithdrawal: true });
      positive++;
      const afterWithdrawal = await state(e);
      assertOwnedConsentReceipt(await post(e.actor.cookie, e.org.id, "declined"),
        "declined", "unchanged");
      assert.deepEqual(await state(e), afterWithdrawal,
        "same decline must not purge again or add duplicate audit");
      await denied(e.actor.cookie, e.org.id, "accepted", 409);
      assert.deepEqual(await state(e), afterWithdrawal,
        "a declined employee must not silently be reaccepted");
    }
    assert.deepEqual(await state(victim), ownStates[2],
      "attacker requests and their own withdrawals must never mutate the victim");
    assert.deepEqual(await state(excluded), ownStates[3],
      "unallowlisted employer must remain fully untouched");
    assert.deepEqual(await ledger(), initialLedger,
      "consent changes cannot write authoritative time, correction, payout or payroll rows");

    console.log(JSON.stringify({
      kind: "tenant-photo-consent-pg16-http",
      method: "POST web-bundy/consent", independentEmployeeActors: 3,
      realHigherIdVictim: true, excludedEmployer: true,
      actualOwnConsentActionsIncludingFirstRefusals: positive,
      firstTimeRefusalsProven: initialRefusals,
      deniedCrossTenantRoleOriginAndBinding: rejected,
      nonHeldPhotoPurgedOnWithdrawal: true,
      heldPhotoIntact: true,
      victimAndUnallowlistedUnchanged: true,
      payrollAndAttendanceUnchanged: true,
      externalProviders: false, productionTested: false,
      certified: false, credits: 0,
    }));
  } finally {
    await pool.end();
  }
}

const direct = process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-photo-consent-http.mjs");
if (direct) {
  const phase = process.argv[2];
  const task = phase === "--bootstrap" ? bootstrap
    : phase === "--prove" ? prove : null;
  if (!task) {
    console.error("PHOTO_CONSENT_REFUSED: use --bootstrap or --prove");
    process.exitCode = 2;
  } else {
    task().catch(error => { console.error(error); process.exitCode = 1; });
  }
}

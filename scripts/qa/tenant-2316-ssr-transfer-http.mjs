/**
 * Additional Form 2316 SSR proof: same-parent legal-employer denial,
 * current-vs-frozen employer after transfer, revocation, forged selectors,
 * and read-only PostgreSQL invariants. Disposable PG16 and fictional users only.
 *
 * This is NOT a client-hydration/API/PDF test or a coverage acceptance receipt.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE, requireDisposable2316Env, verify2316Sources,
  assertOwn2316, assertDenied2316, noForeignMarkers,
} from "./tenant-2316-ssr-transfer-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const certPath = (orgId, workerId, separationId, year = "2026") =>
  PAGE + "?organizationId=" + orgId +
  (workerId === undefined ? "" : "&employeeId=" + workerId) +
  (separationId === undefined ? "" : "&separationId=" + separationId) +
  "&taxYear=" + year;

async function getLocal(path, cookie) {
  assert.ok(path === "/api/account" || path === PAGE || path.startsWith(PAGE + "?"),
    "TENANT_2316_REFUSED: unreviewed HTTP destination");
  const response = await fetch(ORIGIN + path, {
    method: "GET", headers: cookie ? { cookie } : {},
    redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  if (path === "/api/account") {
    try { json = JSON.parse(text); } catch { /* Status checks still required. */ }
  }
  return { status: response.status, text, headers: response.headers, json };
}

export async function prove2316SsrTransferBoundary() {
  // These checks run before any application/DB import or HTTP access.
  requireDisposable2316Env();
  verify2316Sources();
  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const pg16 = Number((await pool.query("SHOW server_version_num"))
      .rows[0].server_version_num);
    assert.ok(pg16 >= 160000 && pg16 < 170000, "Real disposable PG16 required");
    assert.deepEqual(await db.select().from(s.organizations).limit(1), [],
      "Pre-existing employers forbidden");
    assert.deepEqual(await db.select().from(s.users).limit(1), [],
      "Pre-existing users forbidden");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = { ...(await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession)), label: "A" };
    const b = { ...(await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession)), label: "B" };
    for (const actor of [a, b]) {
      await db.insert(s.userLegalEntityGrants).values({
        userId: actor.owner.id, organizationId: actor.org.id,
        legalEntityId: actor.entity.id,
      });
    }
    // A second, genuinely populated legal employer is within A's organization
    // but is NOT granted to A's signed-in payroll owner.
    const [otherEntity] = await db.insert(s.legalEntities).values({
      organizationId: a.org.id, code: "UNGRANTED-" + nonce,
      legalName: "Unshared synthetic entity " + nonce,
      displayName: "Unshared employer", primaryEntity: false,
    }).returning();
    const [otherUnit] = await db.insert(s.orgUnits).values({
      organizationId: a.org.id, legalEntityId: otherEntity.id,
      type: "department", code: "PRIVATE-" + nonce,
      name: "Restricted fictional department",
    }).returning();
    const [otherWorker] = await db.insert(s.employees).values({
      organizationId: a.org.id, legalEntityId: otherEntity.id,
      orgUnitId: otherUnit.id, employeeNo: "UNGRANTED-" + nonce,
      firstName: "Unshared", lastName: "Fictional",
      title: "Synthetic worker", avatarInitials: "UF",
      basicRate: "20000.00", startDate: "2026-01-05",
    }).returning();

    // Persist the separate victim last to prove it exists and is higher-ID.
    const victim = { ...(await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession)), label: "victim" };
    await db.insert(s.userLegalEntityGrants).values({
      userId: victim.owner.id, organizationId: victim.org.id,
      legalEntityId: victim.entity.id,
    });
    const subjects = [a, b, victim];
    // The same-parent ungranted worker is a separate private discriminator.
    // Include its real employee number in denial-response leak checks.
    const deniedSubjects = [...subjects, {
      org: a.org, worker: otherWorker, marker: otherWorker.employeeNo,
    }];
    assert.equal(new Set(subjects.map(x => x.cookie)).size, 3,
      "Two attackers and victim require real independent sessions");
    for (const actor of [a, b]) for (const key of
      ["org", "entity", "unit", "worker", "owner"]) {
      assert.ok(victim[key].id > actor[key].id, "Genuine higher-ID victim " + key);
    }
    assert.ok(victim.worker.id > otherWorker.id,
      "Genuine higher-ID victim worker required");

    for (const actor of subjects) {
      const [sep] = await db.insert(s.separationRecords).values({
        organizationId: actor.org.id, employeeId: actor.worker.id,
        separationType: "resignation", noticeDate: "2026-09-01",
        lastDay: "2026-09-30", status: "released",
        computationSnapshot: {
          sourceFingerprint: { employeeLegalEntityId: actor.entity.id },
        },
      }).returning({ id: s.separationRecords.id });
      actor.separationId = sep.id;
    }
    const [foreignSep] = await db.insert(s.separationRecords).values({
      organizationId: a.org.id, employeeId: otherWorker.id,
      separationType: "resignation", noticeDate: "2026-09-01",
      lastDay: "2026-09-30", status: "released",
      computationSnapshot: {
        sourceFingerprint: { employeeLegalEntityId: otherEntity.id },
      },
    }).returning({ id: s.separationRecords.id });
    const [draftSep] = await db.insert(s.separationRecords).values({
      organizationId: a.org.id, employeeId: a.worker.id,
      separationType: "resignation", noticeDate: "2026-10-01",
      lastDay: "2026-10-31", status: "draft",
    }).returning({ id: s.separationRecords.id });

    const [scopedUser] = await db.insert(s.users).values({
      email: "2316-scoped-" + nonce + "@example.invalid",
      name: "Fictional unit-only payroll", passwordHash: "fictional-session-only",
      role: "bookkeeper", totpEnabled: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: scopedUser.id, organizationId: a.org.id,
      role: "bookkeeper", orgUnitId: a.unit.id, active: true,
    });
    const scopedSession = await fixture.standaloneMakeSession(scopedUser.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, scopedSession.id));

    const tables = [
      "organizations", "legalEntities", "employees", "userLegalEntityGrants",
      "userOrganizations", "separationRecords", "yearEndPriorEvidence",
      "payrollRuns", "auditEvents",
    ];
    async function snapshot(orgId) {
      const state = {};
      for (const name of tables) {
        const table = s[name];
        assert.ok(table?.id, "Missing protected table " + name);
        const orgColumn = name === "organizations" ? table.id : table.organizationId;
        state[name] = plain(await db.select().from(table)
          .where(eq(orgColumn, orgId)).orderBy(asc(table.id)));
      }
      return state;
    }
    async function freeze() {
      return new Map(await Promise.all(subjects.map(async subject =>
        [subject.org.id, await snapshot(subject.org.id)])));
    }
    let before = await freeze();
    async function unchanged(label) {
      for (const subject of subjects) {
        assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id),
          label + ": private employee/tax/payroll/audit SQL changed during HTTP GET");
      }
    }

    let ownReleased = 0, ownGuidance = 0, denied = 0;
    async function deny(path, cookie, label) {
      const response = await getLocal(path, cookie);
      assertDenied2316(response, deniedSubjects, label);
      denied++;
      await unchanged(label);
      return response;
    }
    for (const actor of subjects) {
      const account = await getLocal("/api/account", actor.cookie);
      assert.equal(account.status, 200, "Authenticated persisted account required");
      assert.equal(account.json?.profile?.id, actor.owner.id);
      const ownReleasedPage = await getLocal(
        certPath(actor.org.id, actor.worker.id, actor.separationId), actor.cookie);
      assertOwn2316(ownReleasedPage, actor, subjects, "released");
      ownReleased++;
      await unchanged("own released Form 2316");
      const guidance = await getLocal(
        certPath(actor.org.id, actor.worker.id), actor.cookie);
      assertOwn2316(guidance, actor, subjects, "guidance");
      ownGuidance++;
      await unchanged("own worker-only guidance");
    }

    // A is genuinely denied both worker-only and released-separation views
    // of the other legal employer inside A's own parent organization.
    await deny(certPath(a.org.id, otherWorker.id), a.cookie,
      "same-parent foreign worker-only existence");
    await deny(certPath(a.org.id, otherWorker.id, foreignSep.id), a.cookie,
      "same-parent foreign historical separation");
    await deny(certPath(a.org.id, otherWorker.id, a.separationId), a.cookie,
      "same-parent foreign worker with forged owned separation");
    await deny(certPath(a.org.id, 99999999), a.cookie,
      "nonexistent worker comparison");
    // Same target exists for its own real employer; B and victim also have
    // nonempty own successes above, so 404 is not a missing-fixture artifact.
    for (const actor of [a, b]) {
      for (const foreign of subjects.filter(x => x.org.id !== actor.org.id)) {
        await deny(certPath(actor.org.id, foreign.worker.id), actor.cookie,
          "foreign worker under caller employer");
        await deny(certPath(foreign.org.id, foreign.worker.id, foreign.separationId),
          actor.cookie, "foreign organization and released evidence");
        await deny(certPath(actor.org.id, actor.worker.id, foreign.separationId),
          actor.cookie, "forged cross-tenant separation");
      }
    }
    for (const invalid of [
      certPath(a.org.id, a.worker.id, draftSep.id),
      certPath(a.org.id, a.worker.id, a.separationId, "2025"),
      certPath(a.org.id, a.worker.id, a.separationId, "2101"),
      certPath(a.org.id, undefined, a.separationId),
      certPath(a.org.id, "01"),
      certPath(a.org.id, a.worker.id, a.separationId) +
        "&employeeId=" + victim.worker.id,
      certPath(a.org.id, a.worker.id, a.separationId) +
        "&separationId=" + a.separationId,
      certPath(a.org.id, a.worker.id, a.separationId) +
        "&organizationId=" + victim.org.id,
      certPath(a.org.id, "-1"),
      certPath(a.org.id, "9007199254740992"),
    ]) await deny(invalid, a.cookie, "noncanonical/replayed Form 2316 selector");
    await deny(certPath(a.org.id, a.worker.id, a.separationId),
      scopedSession.cookie, "unit-only payroll user");
    const unauthenticated = await getLocal(
      certPath(victim.org.id, victim.worker.id, victim.separationId));
    assert.ok([302, 303, 307, 308].includes(unauthenticated.status),
      "Anonymous caller must redirect to login");
    assert.ok(unauthenticated.headers.get("location")?.includes("/login"),
      "Anonymous redirect must point to login");
    noForeignMarkers(unauthenticated.text, subjects, "anonymous Form 2316");
    await unchanged("anonymous denial");

    // A worker can legitimately change current legal employer after an
    // already released historical tax separation. A keeps the historical
    // frozen employer grant, not a new grant over the destination employer.
    await db.update(s.employees).set({ legalEntityId: otherEntity.id })
      .where(and(eq(s.employees.organizationId, a.org.id),
        eq(s.employees.id, a.worker.id)));
    before = await freeze();
    const historical = await getLocal(
      certPath(a.org.id, a.worker.id, a.separationId), a.cookie);
    assertOwn2316(historical, a, subjects, "released");
    await unchanged("transferred employee frozen historical employer");
    await deny(certPath(a.org.id, a.worker.id), a.cookie,
      "transferred worker-only selection must use current legal-employer grant");

    // Revoke just A's frozen employer grant, keeping the HTTP session active:
    // the earlier valid historical Form 2316 must now be inaccessible.
    const deletedGrants = await db.delete(s.userLegalEntityGrants).where(and(
      eq(s.userLegalEntityGrants.userId, a.owner.id),
      eq(s.userLegalEntityGrants.organizationId, a.org.id),
      eq(s.userLegalEntityGrants.legalEntityId, a.entity.id),
    )).returning({ id: s.userLegalEntityGrants.id });
    assert.equal(deletedGrants.length, 1);
    before = await freeze();
    const validAccount = await getLocal("/api/account", a.cookie);
    assert.equal(validAccount.status, 200, "Grant revocation must not forge logout");
    assert.equal(validAccount.json?.profile?.id, a.owner.id);
    await deny(certPath(a.org.id, a.worker.id, a.separationId), a.cookie,
      "revoked frozen legal-employer grant");
    await deny(certPath(a.org.id, otherWorker.id, foreignSep.id), a.cookie,
      "revoked grant never expands to other employer");

    // Separately remove B's active employer membership while B's actual
    // authentication cookie remains valid.
    const revokedMembership = await db.update(s.userOrganizations)
      .set({ active: false }).where(and(
        eq(s.userOrganizations.organizationId, b.org.id),
        eq(s.userOrganizations.userId, b.owner.id),
        eq(s.userOrganizations.active, true),
      )).returning({ id: s.userOrganizations.id });
    assert.equal(revokedMembership.length, 1);
    before = await freeze();
    const bAccount = await getLocal("/api/account", b.cookie);
    assert.equal(bAccount.status, 200, "Membership revocation not a session expiry");
    assert.equal(bAccount.json?.profile?.id, b.owner.id);
    await deny(certPath(b.org.id, b.worker.id, b.separationId), b.cookie,
      "revoked employer membership");

    assert.equal(ownReleased, 3);
    assert.equal(ownGuidance, 3);
    assert.ok(denied >= 30, "Full transfer/revocation/forgery matrix must execute");
    const result = {
      family: "form2316-ssr-transfer-boundary",
      fictionalEmployers: 3, genuineSeparateOwners: 3, ownReleased,
      ownGuidance, denied,
      crossOrganizationVictimPresent: true,
      sameParentUngrantableWorkerDenied: true,
      transferredHistoricalEmployerRetained: true,
      workerOnlyCurrentEmployerDeniedAfterTransfer: true,
      revokedLegalEmployerGrantDenied: true,
      revokedMembershipDenied: true, protectedSqlTables: tables.length,
      apiMethodCredits: 0, pageActionCredits: 0,
      independentSecurityReview: "PENDING", productionCertified: false,
    };
    console.log("TENANT_2316_SSR_TRANSFER_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith(
  "scripts/qa/tenant-2316-ssr-transfer-http.mjs")) {
  prove2316SsrTransferBoundary().catch(error => {
    console.error("TENANT_2316_SSR_TRANSFER_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}

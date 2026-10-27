/**
 * Exact-method, fictional employee-self-service development plan tenant proof.
 * Isolated CI only: fresh PG16 on 127.0.0.1:5432/app_db, production-mode
 * localhost Next on 127.0.0.1:3000. No payroll or live providers.
 *
 * CI uses:
 *   node --import tsx scripts/qa/tenant-batches/ess-development-http.mjs seed >> "$GITHUB_ENV"
 *   node --import tsx scripts/qa/tenant-batches/ess-development-http.mjs prove
 *
 * The guard MUST run before importing application or database modules.
 */
import assert from "node:assert/strict";
import {
  constants, closeSync, fstatSync, lstatSync, mkdtempSync, openSync,
  readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { requireDisposableDevelopmentPlans } from "./ess-development-guard.mjs";
import {
  proveOwnDevelopmentRead, proveOwnMilestonePatch, proveOwnProgressPost,
  proveUnchanged,
} from "./ess-development-assertions.mjs";

const mode = process.argv[2];
requireDisposableDevelopmentPlans(process.env, mode);

function fixturePath() {
  const path = process.env.ESS_DEVELOPMENT_FIXTURE_FILE;
  assert.ok(typeof path === "string" &&
    /^\/tmp\/tenant-ess-development-[A-Za-z0-9]+\/fixture\.json$/.test(path),
  "ESS_DEVELOPMENT_REFUSED: expected private CI-only fixture path");
  return path;
}
function readPrivateFixture() {
  const path = fixturePath();
  const dir = lstatSync(dirname(path));
  assert.ok(dir.isDirectory() && (dir.mode & 0o077) === 0 &&
    dir.uid === process.getuid(), "private fixture directory must be owner-only");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    assert.ok(info.isFile() && info.uid === process.getuid() &&
      (info.mode & 0o077) === 0 && info.nlink === 1,
    "private fictional login fixture must be regular, owned, unlinked and mode 0600");
    const fixture = JSON.parse(readFileSync(fd, "utf8"));
    assert.equal(fixture.schemaVersion, 1);
    assert.deepEqual(fixture.employers.map(e => e.label), ["ATTA", "ATTB", "VICTIM"]);
    return fixture;
  } finally {
    closeSync(fd);
  }
}

async function dependencies() {
  const [{ db, pool }, s, table, { asc, eq }, { auditBusinessSnapshot }] =
    await Promise.all([
      import("../../../src/db/index.ts"),
      import("../../../src/db/schema.ts"),
      import("../tenant-table-http.mjs"),
      import("drizzle-orm"),
      import("../tenant-table-invariants.mjs"),
    ]);
  return { db, pool, s, table, asc, eq, auditBusinessSnapshot };
}

async function seed() {
  const { db, pool, s, table } = await dependencies();
  try {
    assert.equal((await db.select({ id: s.organizations.id })
      .from(s.organizations).limit(1)).length, 0,
    "ESS_DEVELOPMENT_REFUSED: database must be fresh and empty");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await table.seedEmployer(label, nonce, table.standaloneMakeSession);
      const [login] = await db.insert(s.users).values({
        email: e.marker.toLowerCase() + "-self@example.invalid",
        name: e.marker + " employee", role: "employee",
        employeeId: e.worker.id, passwordHash: "fictional-not-a-login",
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: login.id, organizationId: e.org.id,
        role: "employee", workerEmployeeId: e.worker.id, active: true,
      });
      const ownSession = await table.standaloneMakeSession(login.id);
      const [peer] = await db.insert(s.employees).values({
        organizationId: e.org.id, legalEntityId: e.entity.id, orgUnitId: e.unit.id,
        employeeNo: e.marker + "-PEER", firstName: "Table",
        lastName: e.marker + "-PEER", title: "Fictional",
        avatarInitials: "TT", basicRate: "20000.00",
        startDate: "2026-01-05",
      }).returning();
      const skillName = e.marker + " growth skill";
      const [skill] = await db.insert(s.hcmSkills).values({
        organizationId: e.org.id, code: "ESS-" + label + "-" + nonce,
        name: skillName, createdByUserId: e.owner.id,
        createdByName: e.owner.name,
      }).returning();
      const planTitle = e.marker + " employee visible development plan";
      const [plan] = await db.insert(s.performanceSkillDevelopmentPlans).values({
        organizationId: e.org.id, employeeId: e.worker.id,
        skillId: skill.id, title: planTitle, objective: e.marker + " growth objective",
        targetProficiency: "4.00", targetDate: "2026-12-15",
        status: "in_progress", employeeVisible: true,
        createdByName: e.owner.name, createdByUserId: e.owner.id,
      }).returning();
      const milestoneTitle = e.marker + " development checkpoint";
      const [milestone] = await db.insert(s.performanceSkillDevelopmentMilestones).values({
        organizationId: e.org.id, planId: plan.id,
        title: milestoneTitle, dueDate: "2026-11-25", status: "open",
      }).returning();
      const seedProgressContent = e.marker + " initial fictional progress evidence";
      const [progress] = await db.insert(s.performanceSkillDevelopmentProgress).values({
        organizationId: e.org.id, planId: plan.id, employeeId: e.worker.id,
        authorUserId: login.id, authorEmployeeId: e.worker.id,
        authorName: login.name, content: seedProgressContent, progressPercent: 12,
      }).returning();
      const peerPlanTitle = e.marker + "-PEER restricted development plan";
      const [peerPlan] = await db.insert(s.performanceSkillDevelopmentPlans).values({
        organizationId: e.org.id, employeeId: peer.id, skillId: skill.id,
        title: peerPlanTitle, objective: e.marker + "-PEER restricted",
        targetProficiency: "3.00", targetDate: "2026-12-20",
        employeeVisible: true, createdByName: e.owner.name,
        createdByUserId: e.owner.id,
      }).returning();
      const peerMilestoneTitle = e.marker + "-PEER restricted milestone";
      const [peerMilestone] = await db.insert(s.performanceSkillDevelopmentMilestones).values({
        organizationId: e.org.id, planId: peerPlan.id,
        title: peerMilestoneTitle, dueDate: "2026-11-29", status: "open",
      }).returning();
      employers.push({
        label, marker: e.marker, orgId: e.org.id, workerId: e.worker.id,
        peerWorkerId: peer.id, userId: login.id, userName: login.name,
        cookie: ownSession.cookie, skillId: skill.id, skillName,
        planId: plan.id, planTitle, milestoneId: milestone.id, milestoneTitle,
        seedProgressId: progress.id, seedProgressContent,
        peerPlanId: peerPlan.id, peerPlanTitle,
        peerMilestoneId: peerMilestone.id, peerMilestoneTitle,
        newProgressContent: e.marker + " real POST progress marker",
      });
    }
    const [a, b, victim] = employers;
    for (const low of [a, b]) {
      for (const idKey of ["orgId", "workerId", "planId", "milestoneId"]) {
        assert.ok(victim[idKey] > low[idKey],
          "higher-ID victim must be genuinely persisted: " + idKey);
      }
    }
    // Separate signed-in attacker accounts whose employeeId deliberately links to
    // the real victim employee, but whose only membership is in the attacker's org.
    for (const attacker of [a, b]) {
      const [forged] = await db.insert(s.users).values({
        email: attacker.marker.toLowerCase() + "-forged@example.invalid",
        name: attacker.marker + " forged link", role: "employee",
        employeeId: victim.workerId, passwordHash: "fictional-not-a-login",
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: forged.id, organizationId: attacker.orgId,
        role: "employee", active: true,
      });
      const session = await table.standaloneMakeSession(forged.id);
      attacker.forgedCookie = session.cookie;
    }
    const dir = mkdtempSync(join(tmpdir(), "tenant-ess-development-"));
    const path = join(dir, "fixture.json");
    const fd = openSync(path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ schemaVersion: 1, employers }));
    } finally {
      closeSync(fd);
    }
    // Only the private filename goes to $GITHUB_ENV, never the fictional cookies.
    process.stdout.write("ESS_DEVELOPMENT_FIXTURE_FILE=" + path + "\n");
  } finally {
    await pool.end();
  }
}

async function prove() {
  const fixture = readPrivateFixture();
  const employers = fixture.employers;
  const [a, b, victim] = employers;
  const { db, pool, s, table, asc, eq, auditBusinessSnapshot } = await dependencies();
  const url = "/api/self/performance/development-plans";
  const req = (actor, method = "GET", body, cookie = actor.cookie, query = "") =>
    table.standaloneRequest(url + query, { method, cookie, body });
  const snapshot = async orgId => {
    const byOrg = t => db.select().from(t)
      .where(eq(t.organizationId, orgId)).orderBy(asc(t.id));
    const [employees, plans, skills, milestones, progress, events, payroll, audit] =
      await Promise.all([
        byOrg(s.employees), byOrg(s.performanceSkillDevelopmentPlans),
        byOrg(s.hcmSkills), byOrg(s.performanceSkillDevelopmentMilestones),
        byOrg(s.performanceSkillDevelopmentProgress),
        byOrg(s.performanceSkillDevelopmentPlanEvents), byOrg(s.payrollRuns),
        byOrg(s.auditEvents),
      ]);
    return { employees, plans, skills, milestones, progress,
      events, payroll, audit: auditBusinessSnapshot(audit) };
  };
  const noVictimLeak = (response, label) => {
    assert.ok(!response.text.includes(victim.marker),
      label + ": victim marker leaked across employer boundary");
  };
  const expectDenied = (response, status, label) => {
    assert.equal(response.status, status,
      label + ": HTTP " + response.status + " " + response.text.slice(0, 180));
    noVictimLeak(response, label);
  };
  try {
    for (const e of employers) {
      assert.equal((await db.select({ id: s.performanceSkillDevelopmentPlans.id })
        .from(s.performanceSkillDevelopmentPlans)
        .where(eq(s.performanceSkillDevelopmentPlans.id, e.planId))
        .limit(1))[0]?.id, e.planId);
    }
    const expected = new Map();
    for (const e of employers) expected.set(e.orgId, await snapshot(e.orgId));

    const victimOwn = await req(victim);
    proveOwnDevelopmentRead(victimOwn, victim);
    let firstRead;
    for (const attacker of [a, b]) {
      const own = await req(attacker);
      proveOwnDevelopmentRead(own, attacker);
      noVictimLeak(own, attacker.label + " own GET");
      if (firstRead) {
        assert.throws(() => proveOwnDevelopmentRead(firstRead, attacker),
          "a response from another employer cannot be accepted as own data");
      }
      firstRead = own;
      // The GET route has no tenant selector: forged query selectors MUST be ignored.
      const forgedQuery = "?organizationId=" + victim.orgId +
        "&employeeId=" + victim.workerId + "&planId=" + victim.planId;
      const scoped = await req(attacker, "GET", undefined, attacker.cookie, forgedQuery);
      proveOwnDevelopmentRead(scoped, attacker);
      noVictimLeak(scoped, attacker.label + " forged GET query");

      // Real foreign IDs: the own signed-in worker must never modify victim rows.
      expectDenied(await req(attacker, "POST", {
        planId: victim.planId, content: attacker.newProgressContent,
        progressPercent: 37,
      }), 404, attacker.label + " foreign plan POST");
      expectDenied(await req(attacker, "PATCH", {
        milestoneId: victim.milestoneId, status: "completed",
      }), 404, attacker.label + " foreign milestone PATCH");
      // Same-employer other-worker IDOR is a separate boundary from tenant ID.
      expectDenied(await req(attacker, "POST", {
        planId: attacker.peerPlanId, content: attacker.newProgressContent,
        progressPercent: 37,
      }), 404, attacker.label + " peer plan POST");
      expectDenied(await req(attacker, "PATCH", {
        milestoneId: attacker.peerMilestoneId, status: "completed",
      }), 404, attacker.label + " peer milestone PATCH");

      // A signed-in account linked to the victim worker but lacking victim
      // membership must be rejected at the actual context gate (403).
      expectDenied(await req(attacker, "GET", undefined, attacker.forgedCookie),
        403, attacker.label + " forged foreign employee link GET");
      expectDenied(await req(attacker, "POST", {
        planId: victim.planId, content: attacker.newProgressContent,
        progressPercent: 37,
      }, attacker.forgedCookie), 403,
      attacker.label + " forged foreign employee link POST");
      expectDenied(await req(attacker, "PATCH", {
        milestoneId: victim.milestoneId, status: "completed",
      }, attacker.forgedCookie), 403,
      attacker.label + " forged foreign employee link PATCH");
      for (const other of employers) {
        proveUnchanged(expected.get(other.orgId), await snapshot(other.orgId),
          attacker.label + " negative requests must not mutate " + other.label);
      }
    }

    // Each real own mutation has to change only that worker's records, with audit.
    // Check all other employers (including previously written ones) after each.
    for (const actor of employers) {
      const beforePost = await snapshot(actor.orgId);
      proveUnchanged(expected.get(actor.orgId), beforePost, actor.label + " pre-POST");
      const post = await req(actor, "POST", {
        planId: actor.planId, content: actor.newProgressContent,
        progressPercent: 37,
      });
      const afterPost = await snapshot(actor.orgId);
      proveOwnProgressPost(beforePost, afterPost, actor, post);

      const patch = await req(actor, "PATCH", {
        milestoneId: actor.milestoneId, status: "completed",
      });
      const afterPatch = await snapshot(actor.orgId);
      proveOwnMilestonePatch(afterPost, afterPatch, actor, patch);
      expected.set(actor.orgId, afterPatch);
      for (const other of employers.filter(e => e.orgId !== actor.orgId)) {
        proveUnchanged(expected.get(other.orgId), await snapshot(other.orgId),
          actor.label + " legitimate mutations must not touch " + other.label);
      }
      const reread = await req(actor);
      assert.equal(reread.status, 200);
      assert.equal(reread.json?.plans?.length, 1);
      assert.equal(reread.json.plans[0].id, actor.planId);
      assert.equal(reread.json.plans[0].milestones[0].status, "completed");
      assert.ok(reread.json.plans[0].progress.some(p =>
        p.content === actor.newProgressContent && p.progressPercent === 37));
      if (actor.label !== "VICTIM") noVictimLeak(reread, actor.label + " reread");
    }
    console.log(JSON.stringify({
      kind: "tenant-ess-development-plans-pg16-http",
      methods: ["GET self/performance/development-plans",
        "POST self/performance/development-plans",
        "PATCH self/performance/development-plans"],
      twoIndependentSignedInAttackers: true,
      realHigherIdVictim: true, populatedOwnGets: 3,
      forgedQuerySelectorsScopedToSession: 2,
      foreignPlanAndMilestoneDenials: 4,
      sameEmployerPeerIdorDenials: 4,
      forgedForeignEmployeeLinkDenials: 6,
      ownPostPersistedWithAudit: 3,
      ownPatchPersistedWithAudit: 3,
      otherEmployersUnchanged: true,
      realHttpPg16: true, coverageCredits: 0, productionCertified: false,
    }));
  } finally {
    await pool.end();
    const path = fixturePath();
    assert.equal(basename(path), "fixture.json");
    rmSync(dirname(path), { recursive: true, force: true });
  }
}

(mode === "seed" ? seed() : prove()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

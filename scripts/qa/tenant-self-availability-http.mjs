/**
 * Executable tenant-isolation proof for /api/self/availability GET + POST.
 *
 * Two independently authenticated fictional employee accounts, an additional
 * different worker in each employer, and a separate higher-ID victim employer.
 * Exercise actual Next.js HTTP + PostgreSQL, never mocked route handlers.
 * Provider/payroll/roster writes are disabled. No coverage manifest credits
 * are awarded by this provisional proof.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { requireDisposableSelfAvailability, requireSensitiveNoStoreCache } from "./tenant-self-availability-guard.mjs";
import {
  requireDisposableAvailability, assertOwnAvailability, assertCreated,
  assertRemovedFuture, assertPrivateDenial, assertUnchanged,
} from "./tenant-self-availability-contract.mjs";

const ENDPOINT = "/api/self/availability";

async function awaitLocalServer(server, getLogs) {
  for (let retry = 0; retry < 60; retry++) {
    if (server.exitCode !== null) throw new Error("Disposable Next server stopped: " + getLogs());
    try {
      const response = await fetch("http://127.0.0.1:3000/login", { redirect: "manual", cache: "no-store" });
      if (response.ok) return;
    } catch { /* Local listener not ready yet. */ }
    await delay(1000);
  }
  throw new Error("Disposable Next server did not become ready: " + getLogs());
}

async function terminate(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise(resolve => server.once("exit", resolve)), delay(4000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

export async function verifySelfAvailabilityTenantHttp() {
  // No application/DB modules load until the disposable target passes.
  requireDisposableSelfAvailability();
  requireDisposableAvailability();
  const [{ db, pool }, schema, table, dateLib, availability,
    { auditBusinessSnapshot }] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
    import("../../src/lib/workforce-employee-upcoming-week.ts"),
    import("../../src/lib/workforce-employee-availability-preferences.ts"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const {
    organizations, users, userOrganizations, employeeAvailabilityRules, employees,
    auditEvents, payrollRuns, sessions,
    employeeScheduleAssignments, timePunches, leaveRequests,
  } = schema;
  const { eq, and } = await import("drizzle-orm");
  const { seedEmployer, standaloneMakeSession, standaloneRequest, addWorker } = table;
  const today = dateLib.manilaWorkDate();
  const future = availability.addAvailabilityDays(today, 7);
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const empty = await db.select({ id: organizations.id }).from(organizations).limit(1);
  assert.equal(empty.length, 0, "SELF_AVAILABILITY_PROOF_REFUSED: database must be a fresh, empty disposable fixture");

  const snapshots = (orgId) => Promise.all([
    db.select().from(employeeAvailabilityRules)
      .where(eq(employeeAvailabilityRules.organizationId, orgId)).orderBy(employeeAvailabilityRules.id),
    db.select().from(employees)
      .where(eq(employees.organizationId, orgId)).orderBy(employees.id),
    db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, orgId)).orderBy(auditEvents.id),
    db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, orgId)).orderBy(payrollRuns.id),
  ]);

  const sourceSnapshot = async orgId => {
    const [rules, staff, memberships, payroll, assignments, punches, leaves, audit] =
      await Promise.all([
        db.select().from(employeeAvailabilityRules)
          .where(eq(employeeAvailabilityRules.organizationId, orgId))
          .orderBy(employeeAvailabilityRules.id),
        db.select().from(employees).where(eq(employees.organizationId, orgId))
          .orderBy(employees.id),
        db.select().from(userOrganizations)
          .where(eq(userOrganizations.organizationId, orgId))
          .orderBy(userOrganizations.id),
        db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, orgId))
          .orderBy(payrollRuns.id),
        db.select().from(employeeScheduleAssignments)
          .where(eq(employeeScheduleAssignments.organizationId, orgId))
          .orderBy(employeeScheduleAssignments.id),
        db.select().from(timePunches).where(eq(timePunches.organizationId, orgId))
          .orderBy(timePunches.id),
        db.select().from(leaveRequests).where(eq(leaveRequests.organizationId, orgId))
          .orderBy(leaveRequests.id),
        db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId))
          .orderBy(auditEvents.id),
      ]);
    return JSON.parse(JSON.stringify({
      rules, employees: staff, memberships, payroll,
      assignments, punches, leaves, audit: auditBusinessSnapshot(audit),
    }));
  };
  const proofActor = e => ({
    ...e, self: { ...e.self, userId: e.self.id, cookie: e.selfCookie },
  });

  async function seedEmployeeEmployer(label) {
    const e = await seedEmployer(label, nonce, standaloneMakeSession);
    const [self] = await db.insert(users).values({
      email: (e.marker + "-ess@example.invalid").toLowerCase(),
      name: e.marker + " fictional employee",
      role: "employee", employeeId: e.worker.id, active: true,
      passwordHash: "disposable-only-not-a-login",
    }).returning();
    await db.insert(userOrganizations).values({
      userId: self.id, organizationId: e.org.id, role: "employee",
      workerEmployeeId: e.worker.id, active: true,
    });
    const session = await standaloneMakeSession(self.id);
    // Satisfy any privileged-session policy in this fictional-only authenticated proof.
    await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.id));
    const [rule] = await db.insert(employeeAvailabilityRules).values({
      organizationId: e.org.id, employeeId: e.worker.id, weekday: 1,
      startTime: "13:00", endTime: "15:00", availabilityType: "unavailable",
      effectiveFrom: today, notes: e.marker + " private weekly rule",
      createdBy: self.name, createdByUserId: self.id,
    }).returning();
    return { ...e, self, selfCookie: session.cookie, rule };
  }

  let server = null;
  try {
    const attackerA = await seedEmployeeEmployer("ATTA");
    const attackerB = await seedEmployeeEmployer("ATTB");
    const attackers = [attackerA, attackerB];

    // Seed the peers before the victim, so the victim's actual employee and
    // availability IDs exceed *all* attacker and same-employer peer IDs,
    // not merely the primary attacker IDs. Never guess or hardcode IDs.
    const peers = [];
    for (const attacker of attackers) {
      const peer = await addWorker(attacker, "PEER", { payProfile: false });
      const [peerRule] = await db.insert(employeeAvailabilityRules).values({
        organizationId: attacker.org.id, employeeId: peer.id, weekday: 3,
        startTime: "08:00", endTime: "10:00", availabilityType: "unavailable",
        effectiveFrom: today, notes: attacker.marker + " PEER PRIVATE",
        createdBy: "Fictional peer",
      }).returning();
      const [peerUser] = await db.insert(users).values({
        email: (attacker.marker + "-peer-ess@example.invalid").toLowerCase(),
        name: attacker.marker + " fictional peer employee",
        role: "employee", employeeId: peer.id, active: true,
        passwordHash: "disposable-peer-only", totpEnabled: true,
      }).returning();
      await db.insert(userOrganizations).values({
        userId: peerUser.id, organizationId: attacker.org.id,
        role: "employee", workerEmployeeId: peer.id, active: true,
      });
      const peerSession = await standaloneMakeSession(peerUser.id);
      await db.update(sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(sessions.id, peerSession.id));
      peers.push({ employee: peer, rule: peerRule,
        user: peerUser, cookie: peerSession.cookie });
    }

    const victim = await seedEmployeeEmployer("VICTIM");
    assert.ok(victim.org.id > attackerA.org.id && victim.org.id > attackerB.org.id);
    assert.ok(victim.worker.id > attackerA.worker.id && victim.worker.id > attackerB.worker.id);
    for (const [index, actor] of attackers.entries()) {
      assert.ok(victim.worker.id > peers[index].employee.id,
        "higher-ID victim must exceed actual same-company peer worker IDs");
      assert.ok(victim.rule.id > peers[index].rule.id && victim.rule.id > actor.rule.id,
        "higher-ID victim must exceed actual attacker and peer availability IDs");
    }

    const forgedCookies = [];
    for (const attacker of attackers) {
      const [forged] = await db.insert(users).values({
        name: attacker.marker + " forged foreign employee link",
        email: (attacker.marker + "-forged-availability@example.invalid").toLowerCase(),
        role: "employee", employeeId: victim.worker.id, active: true,
        passwordHash: "disposable-forged-only", totpEnabled: true,
      }).returning();
      await db.insert(userOrganizations).values({
        userId: forged.id, organizationId: attacker.org.id,
        role: "employee", active: true,
      });
      const forgedSession = await standaloneMakeSession(forged.id);
      await db.update(sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(sessions.id, forgedSession.id));
      forgedCookies.push(forgedSession.cookie);
    }

    const victimRowsBefore = await snapshots(victim.org.id);
    const victimSourceBefore = await sourceSnapshot(victim.org.id);
    assert.equal(victimRowsBefore[0].length, 1);
    const peerRowsBefore = await Promise.all(peers.map((p, i) => db.select()
      .from(employeeAvailabilityRules).where(and(
        eq(employeeAvailabilityRules.organizationId, attackers[i].org.id),
        eq(employeeAvailabilityRules.employeeId, p.employee.id),
      ))));

    // Only the newly started localhost process receives the synthetic server flag.
    server = spawn(process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"], {
        env: { ...process.env, WFM_EMPLOYEE_AVAILABILITY_ENABLED: "true" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    let logs = "";
    const capture = chunk => { logs = (logs + String(chunk)).slice(-12000); };
    server.stdout.on("data", capture);
    server.stderr.on("data", capture);
    await awaitLocalServer(server, () => logs);

    const request = (path, options = {}) => standaloneRequest(path, options);
    const validDraft = (marker, weekday) => ({
      action: "create", weekday, startTime: "09:00", endTime: "12:00",
      availabilityType: "preferred", effectiveFrom: future,
      effectiveUntil: null, notes: marker + " owned new availability",
    });
    async function expect(path, options, status, label) {
      const response = await request(path, options);
      assert.equal(response.status, status, label + ": " + response.status + " " + response.text.slice(0, 190));
      // Examine actual HTTP response directives on every authenticated GET:
      // Next may rewrite private/no-store to no-store/max-age=0.
      if (status === 200 && path === ENDPOINT && (options?.method ?? "GET") === "GET") {
        requireSensitiveNoStoreCache(response.headers);
      }
      assert.ok(!response.text.includes(victim.marker) || options?.cookie === victim.selfCookie,
        label + ": unrelated victim marker appeared");
      return response;
    }
    async function deniedSource(path, options, status, label, forbidden = []) {
      const before = await Promise.all([attackerA, attackerB, victim]
        .map(e => sourceSnapshot(e.org.id)));
      const response = await expect(path, options, status, label);
      assertPrivateDenial(response, status, forbidden);
      const after = await Promise.all([attackerA, attackerB, victim]
        .map(e => sourceSnapshot(e.org.id)));
      for (let i = 0; i < before.length; i++) {
        assertUnchanged(before[i], after[i],
          label + ": no employee, audit, availability, roster or payroll SQL writes");
      }
      return response;
    }

    // The victim is real, populated and readable only through their own login.
    const victimOwn = await expect(ENDPOINT, { cookie: victim.selfCookie }, 200, "victim own GET");
    assert.ok(victimOwn.json?.rules?.some(row => row.id === victim.rule.id &&
      row.notes === victim.marker + " private weekly rule"));
    assertOwnAvailability(victimOwn, proofActor(victim),
      (await sourceSnapshot(victim.org.id)).rules, today,
      [attackerA.marker + " private weekly rule", attackerB.marker + " private weekly rule"]);

    await expect(ENDPOINT, {}, 401, "anonymous GET");
    await expect(ENDPOINT, { cookie: attackerA.cookie }, 403, "company owner cannot use ESS GET");
    await expect(ENDPOINT, { method: "POST", body: validDraft(attackerA.marker, 5) },
      401, "anonymous POST");

    for (const [idx, own] of attackers.entries()) {
      const peer = peers[idx];
      const owner = { cookie: own.selfCookie };
      const start = await expect(ENDPOINT, owner, 200, "attacker own GET");

      assert.ok(start.json?.rules?.some(row => row.id === own.rule.id &&
        row.notes === own.marker + " private weekly rule"));
      assertOwnAvailability(start, proofActor(own),
        (await sourceSnapshot(own.org.id)).rules, today,
        [victim.marker, own.marker + " PEER PRIVATE"]);
      const peerResponse = await expect(ENDPOINT, { cookie: peer.cookie }, 200,
        "independent same-employer peer GET");
      assertOwnAvailability(peerResponse, {
        ...own, worker: peer.employee,
        marker: own.marker + " PEER",
        self: { userId: peer.user.id, name: peer.user.name, cookie: peer.cookie },
      }, (await sourceSnapshot(own.org.id)).rules, today,
      [victim.marker, own.marker + " private weekly rule"]);
      assert.ok(!start.text.includes(peer.rule.notes), "same-employer second worker must remain private");
      assert.ok(!start.text.includes(victim.marker), "real victim must not appear in own GET");

      // GET never trusts supplied tenant or worker IDs from the browser.
      await deniedSource(ENDPOINT + "?organizationId=" + victim.org.id,
        owner, 400, "forged victim employer GET", [victim.marker]);
      await deniedSource(ENDPOINT + "?employeeId=" + victim.worker.id,
        owner, 400, "forged victim worker GET", [victim.marker]);

      // POST refuses forged selectors in URL or JSON and cannot delete either
      // a foreign employer's object or a different worker's same-employer object.
      await deniedSource(ENDPOINT + "?organizationId=" + victim.org.id,
        { ...owner, method: "POST", body: validDraft(own.marker, 5) },
        400, "forged victim employer POST URL", [victim.marker]);
      await deniedSource(ENDPOINT,
        { ...owner, method: "POST", body: {
          ...validDraft(own.marker, 5), organizationId: victim.org.id,
          employeeId: victim.worker.id,
        } }, 400, "forged victim identifiers POST JSON", [victim.marker]);
      await deniedSource(ENDPOINT,
        { ...owner, method: "POST", body: { action: "remove", ruleId: victim.rule.id } },
        409, "foreign employer object removal denial", [victim.marker]);
      await deniedSource(ENDPOINT,
        { ...owner, method: "POST", body: { action: "remove", ruleId: peer.rule.id } },
        409, "same employer different worker removal denial",
        [victim.marker, own.marker + " PEER PRIVATE"]);
      const opposite = own === attackerA ? attackerB : attackerA;
      await deniedSource(ENDPOINT,
        { ...owner, method: "POST",
          body: { action: "remove", ruleId: opposite.rule.id } },
        409, "other real attacker employer object removal denial", [victim.marker]);

      // Real authorized create and readback prove that this is not a generic
      // 403/empty-response smoke test. The mutation is preferences only.
      const beforeCreate = await sourceSnapshot(own.org.id);
      const otherBeforeCreate = await sourceSnapshot(
        own === attackerA ? attackerB.org.id : attackerA.org.id);
      const created = await expect(ENDPOINT,
        { ...owner, method: "POST", body: validDraft(own.marker, 5) },
        201, "authenticated own create");
      assertCreated(beforeCreate, await sourceSnapshot(own.org.id),
        proofActor(own), created, validDraft(own.marker, 5));
      assertUnchanged(otherBeforeCreate, await sourceSnapshot(
        own === attackerA ? attackerB.org.id : attackerA.org.id),
        "positive own create cannot change other employer SQL rows");
      assert.equal(created.json?.saved, true);
      assert.equal(created.json?.publishedRosterChanged, false);
      assert.equal(created.json?.payrollMutationPerformed, false);
      assert.ok(Number.isSafeInteger(created.json?.id) && created.json.id > 0);
      const ownAfterCreate = await expect(ENDPOINT, owner, 200, "own create readback");
      assert.ok(ownAfterCreate.json?.rules?.some(row => row.id === created.json.id &&
        row.notes === own.marker + " owned new availability"));
      assertOwnAvailability(ownAfterCreate, proofActor(own),
        (await sourceSnapshot(own.org.id)).rules, today,
        [victim.marker, own.marker + " PEER PRIVATE"]);
      await deniedSource(ENDPOINT, { ...owner, method: "POST",
        body: validDraft(own.marker, 5) }, 409,
      "duplicated own preference cannot insert or audit twice", [victim.marker]);

      const beforeRemove = await sourceSnapshot(own.org.id);
      const target = beforeRemove.rules.find(row => row.id === created.json.id);
      assert.ok(target, "removal target must be actual own PostgreSQL rule");
      const removed = await expect(ENDPOINT,
        { ...owner, method: "POST", body: { action: "remove", ruleId: created.json.id } },
        200, "owned future preference removal");
      assertRemovedFuture(beforeRemove, await sourceSnapshot(own.org.id),
        proofActor(own), removed, target);
      assert.equal(removed.json?.removed, true);
      assert.equal(removed.json?.publishedRosterChanged, false);
      assert.equal(removed.json?.payrollMutationPerformed, false);
      const finalRead = await expect(ENDPOINT, owner, 200, "own final read");
      assert.ok(finalRead.json?.rules?.some(row => row.id === own.rule.id));
      assert.ok(!finalRead.json?.rules?.some(row => row.id === created.json.id));
      assert.ok(!finalRead.text.includes(peer.rule.notes));
      assertOwnAvailability(finalRead, proofActor(own),
        (await sourceSnapshot(own.org.id)).rules, today,
        [victim.marker, own.marker + " PEER PRIVATE"]);
    }

    for (const [i, actor] of attackers.entries()) {
      await deniedSource(ENDPOINT, { cookie: forgedCookies[i] }, 403,
        "copied victim employeeId without victim membership GET", [victim.marker]);
      await deniedSource(ENDPOINT, { cookie: forgedCookies[i], method: "POST",
        body: { action: "remove", ruleId: victim.rule.id } }, 403,
        "copied victim employeeId without victim membership POST", [victim.marker]);
      await deniedSource(ENDPOINT, { cookie: actor.cookie }, 403,
        "company owner cannot read ESS availability", [victim.marker]);
    }

    const victimRowsAfter = await snapshots(victim.org.id);
    assertUnchanged(victimSourceBefore, await sourceSnapshot(victim.org.id),
      "real higher-ID victim full availability, HR, payroll and audit source");
    assert.deepEqual(victimRowsAfter, victimRowsBefore,
      "Cross-employer attempts must leave victim availability, employees, audit and payroll unchanged");
    for (const [idx, peer] of peers.entries()) {
      const peerRowsAfter = await db.select().from(employeeAvailabilityRules).where(and(
        eq(employeeAvailabilityRules.organizationId, attackers[idx].org.id),
        eq(employeeAvailabilityRules.employeeId, peer.employee.id),
      ));
      assert.deepEqual(peerRowsAfter, peerRowsBefore[idx],
        "Same-employer different-worker availability must remain unchanged");
    }
    console.log(JSON.stringify({ kind: "self-availability-tenant-http",
      fictionalEmployers: 3, independentEmployeeAttackers: 2,
      realOwnGetAndCreateRemove: true, foreignEmployerAndPeerDenials: true,
      victimDatabaseUnchanged: true, writes: "fictional preference-only",
      payrollOrProviderWrites: false, proof: "synthetic-PG16-localhost",
      productionCertified: false, creditedInTenantManifest: false }));
  } finally {
    await terminate(server);
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-self-availability-http.mjs")) {
  verifySelfAvailabilityTenantHttp().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
}

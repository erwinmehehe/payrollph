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
  const [{ db, pool }, schema, table, dateLib, availability] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
    import("../../src/lib/workforce-employee-upcoming-week.ts"),
    import("../../src/lib/workforce-employee-availability-preferences.ts"),
  ]);
  const {
    organizations, users, userOrganizations, employeeAvailabilityRules, employees,
    auditEvents, payrollRuns, sessions,
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
    const victim = await seedEmployeeEmployer("VICTIM");
    assert.ok(victim.org.id > attackerA.org.id && victim.org.id > attackerB.org.id);
    assert.ok(victim.worker.id > attackerA.worker.id && victim.worker.id > attackerB.worker.id);
    const attackers = [attackerA, attackerB];

    const peers = [];
    for (const attacker of attackers) {
      const peer = await addWorker(attacker, "PEER", { payProfile: false });
      const [peerRule] = await db.insert(employeeAvailabilityRules).values({
        organizationId: attacker.org.id, employeeId: peer.id, weekday: 3,
        startTime: "08:00", endTime: "10:00", availabilityType: "unavailable",
        effectiveFrom: today, notes: attacker.marker + " PEER PRIVATE",
        createdBy: "Fictional peer",
      }).returning();
      peers.push({ employee: peer, rule: peerRule });
    }

    // Extra real victim-only rows force a higher rule ID (>6) than the
    // attackers' owned IDs. No fake numeric target or missing-object 409 can
    // masquerade as a cross-employer tenant isolation denial.
    const victimExtraRules = await db.insert(employeeAvailabilityRules).values(
      Array.from({ length: 7 }, (_, index) => ({
        organizationId: victim.org.id, employeeId: victim.worker.id,
        weekday: index, startTime: "07:00", endTime: "08:00",
        availabilityType: "preferred", effectiveFrom: future,
        notes: victim.marker + " VICTIM PRIVATE " + index,
        createdBy: victim.self.name, createdByUserId: victim.self.id,
      })),
    ).returning();
    assert.equal(victimExtraRules.length, 7);
    const victimTarget = victimExtraRules.at(-1);
    assert.ok(victimTarget && victimTarget.id > 6 &&
      victimTarget.id > attackerA.rule.id && victimTarget.id > attackerB.rule.id,
      "Foreign removal must target a real higher-ID persisted victim rule");

    const victimRowsBefore = await snapshots(victim.org.id);
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

    // The victim is real, populated and readable only through their own login.
    const victimOwn = await expect(ENDPOINT, { cookie: victim.selfCookie }, 200, "victim own GET");
    assert.ok(victimOwn.json?.rules?.some(row => row.id === victim.rule.id &&
      row.notes === victim.marker + " private weekly rule"));
    assert.ok(victimOwn.json?.rules?.some(row => row.id === victimTarget.id &&
      row.notes === victimTarget.notes),
      "Higher-ID victim-only rule must really be visible to the victim employee");

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
      assert.ok(!start.text.includes(peer.rule.notes), "same-employer second worker must remain private");
      assert.ok(!start.text.includes(victim.marker), "real victim must not appear in own GET");

      // GET never trusts supplied tenant or worker IDs from the browser.
      await expect(ENDPOINT + "?organizationId=" + victim.org.id,
        owner, 400, "forged victim employer GET");
      await expect(ENDPOINT + "?employeeId=" + victim.worker.id,
        owner, 400, "forged victim worker GET");

      // POST refuses forged selectors in URL or JSON and cannot delete either
      // a foreign employer's object or a different worker's same-employer object.
      await expect(ENDPOINT + "?organizationId=" + victim.org.id,
        { ...owner, method: "POST", body: validDraft(own.marker, 5) },
        400, "forged victim employer POST URL");
      await expect(ENDPOINT,
        { ...owner, method: "POST", body: {
          ...validDraft(own.marker, 5), organizationId: victim.org.id,
          employeeId: victim.worker.id,
        } }, 400, "forged victim identifiers POST JSON");
      await expect(ENDPOINT,
        { ...owner, method: "POST", body: { action: "remove", ruleId: victimTarget.id } },
        409, "real higher-ID foreign employer object removal denial");
      await expect(ENDPOINT,
        { ...owner, method: "POST", body: { action: "remove", ruleId: peer.rule.id } },
        409, "same employer different worker removal denial");

      // Real authorized create and readback prove that this is not a generic
      // 403/empty-response smoke test. The mutation is preferences only.
      const created = await expect(ENDPOINT,
        { ...owner, method: "POST", body: validDraft(own.marker, 5) },
        201, "authenticated own create");
      assert.equal(created.json?.saved, true);
      assert.equal(created.json?.publishedRosterChanged, false);
      assert.equal(created.json?.payrollMutationPerformed, false);
      assert.ok(Number.isSafeInteger(created.json?.id) && created.json.id > 0);
      const ownAfterCreate = await expect(ENDPOINT, owner, 200, "own create readback");
      assert.ok(ownAfterCreate.json?.rules?.some(row => row.id === created.json.id &&
        row.notes === own.marker + " owned new availability"));

      const removed = await expect(ENDPOINT,
        { ...owner, method: "POST", body: { action: "remove", ruleId: created.json.id } },
        200, "owned future preference removal");
      assert.equal(removed.json?.removed, true);
      assert.equal(removed.json?.publishedRosterChanged, false);
      assert.equal(removed.json?.payrollMutationPerformed, false);
      const finalRead = await expect(ENDPOINT, owner, 200, "own final read");
      assert.ok(finalRead.json?.rules?.some(row => row.id === own.rule.id));
      assert.ok(!finalRead.json?.rules?.some(row => row.id === created.json.id));
      assert.ok(!finalRead.text.includes(peer.rule.notes));
    }

    const victimRowsAfter = await snapshots(victim.org.id);
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
    // A surviving unrelated employer grant must NOT preserve access to the
    // revoked worker's original employer. The exact same session stays active.
    const originalEmployerBeforeRevocation = await snapshots(attackerA.org.id);
    const unrelatedEmployerBeforeRevocation = await snapshots(attackerB.org.id);
    await db.insert(userOrganizations).values({
      userId: attackerA.self.id,
      organizationId: attackerB.org.id,
      role: "employee", active: true,
    });
    const revoked = await db.update(userOrganizations)
      .set({ active: false })
      .where(and(
        eq(userOrganizations.userId, attackerA.self.id),
        eq(userOrganizations.organizationId, attackerA.org.id),
      )).returning({ id: userOrganizations.id });
    assert.equal(revoked.length, 1, "Only the original employer grant should be revoked");
    const stillAuthenticated = await request("/api/auth/me", { cookie: attackerA.selfCookie });
    assert.equal(stillAuthenticated.status, 200, "The original employee session must still authenticate");
    assert.equal(stillAuthenticated.json?.user?.id, attackerA.self.id,
      "Revocation proof cannot pass through an anonymous or expired session");

    await expect(ENDPOINT, { cookie: attackerA.selfCookie }, 403,
      "revoked original employer membership denies previously owned GET");
    await expect(ENDPOINT, {
      cookie: attackerA.selfCookie, method: "POST",
      body: { action: "remove", ruleId: attackerA.rule.id },
    }, 403, "revoked original employer membership denies previously owned POST");
    assert.deepEqual(await snapshots(attackerA.org.id), originalEmployerBeforeRevocation,
      "Rejected revoked-session requests must not alter the original employer");
    assert.deepEqual(await snapshots(attackerB.org.id), unrelatedEmployerBeforeRevocation,
      "Surviving cross-employer membership must not authorize unrelated writes");
    assert.deepEqual(await snapshots(victim.org.id), victimRowsBefore,
      "Revocation and denial must preserve the victim's audit and private availability");

    console.log(JSON.stringify({ kind: "self-availability-tenant-http",
      fictionalEmployers: 3, independentEmployeeAttackers: 2,
      realOwnGetAndCreateRemove: true, foreignEmployerAndPeerDenials: true,
      realVictimRuleIdAboveSix: true, revokedMemberDeniedBothMethods: true,
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

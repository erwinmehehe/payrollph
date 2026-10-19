/**
 * SECOND-PASS tenant isolation: actual production-mode HTTP against disposable
 * PostgreSQL 16, with a victim and TWO independent authenticated attacker orgs.
 * Unlike the historical 1..6 anonymous sweep, every victim-only ID is real,
 * belongs exclusively to the victim, and exceeds 6.
 *
 * No live DB, production endpoint, provider credential or transfer is permitted.
 * All mutations use fictional CI records and a dedicated localhost server.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  apiKeys, approvalChainPolicies, assets, documents, employees, leavePolicies, legalEntities, organizations, orgUnits, payrollEntries,
  payrollRuns, payslips, providerEvents, scimIdentities, scimTokens,
  sessions, userOrganizations, users, employeeHrCases, employeeHrCaseMessages, birWithholdingRemittanceBatches,
} from "../../src/db/schema";
import { mintApiKey } from "../../src/lib/api-keys";
import { mintScimToken } from "../../src/lib/scim";
import { SECOND_PASS_ROUTES, SECOND_PASS_FAMILIES } from "./tenant-second-pass-manifest.mjs";

const BASE = process.env.SECURITY_SMOKE_URL ?? "";
const ORIGIN = { origin: BASE, "sec-fetch-site": "same-origin" };
let assertions = 0;

function requireDisposable() {
  let app;
  let database;
  try {
    app = new URL(BASE);
    database = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    throw new Error("Tenant second pass requires explicit local database and server URLs.");
  }
  if (
    process.env.CI !== "true" ||
    process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
    app.protocol !== "http:" || app.hostname !== "127.0.0.1" || app.port !== "3000" ||
    database.protocol !== "postgresql:" ||
    !["127.0.0.1", "localhost"].includes(database.hostname) ||
    database.port !== "5432" || database.pathname !== "/app_db" ||
    process.env.PAYMONGO_DISBURSEMENTS_ENABLED === "true" ||
    process.env.XENDIT_PAYOUTS_ENABLED === "true"
  ) {
    throw new Error("Refusing tenant second pass outside isolated CI localhost PostgreSQL.");
  }
}

async function request(path, { method = "GET", bearer, cookie, scim, body, headers = {} } = {}) {
  const h = { ...headers };
  if (bearer || scim) h.authorization = "Bearer " + (bearer ?? scim);
  if (cookie) h.cookie = cookie;
  if (method !== "GET") Object.assign(h, ORIGIN);
  if (body !== undefined) h["content-type"] = "application/json";
  const response = await fetch(new URL(path, BASE), {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    cache: "no-store",
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json, headers: response.headers };
}

function expectStatus(response, status, label) {
  assert.equal(response.status, status, label + " got " + response.status + " " + response.text.slice(0, 160));
  assertions++;
  return response;
}

function list(response, field, label) {
  expectStatus(response, 200, label);
  assert.ok(response.json && Array.isArray(response.json[field]), label + " must have a data array");
  assertions++;
  return response.json[field];
}

function ownOnly(rows, ownId, foreignIds, label, field = "id") {
  const ids = rows.map((row) => Number(row[field]));
  assert.ok(ids.includes(ownId), label + " own seeded fixture missing (empty-response false pass)");
  for (const id of foreignIds) assert.ok(!ids.includes(id), label + " disclosed foreign record " + id);
  assertions++;
}

async function makeSession(userId) {
  const raw = randomBytes(32).toString("hex");
  const [row] = await db.insert(sessions).values({
    userId,
    tokenHash: createHash("sha256").update(raw).digest("hex"),
    expiresAt: new Date(Date.now() + 3_600_000),
    lastSeenAt: new Date(),
  }).returning({ id: sessions.id });
  return { id: row.id, cookie: "__Host-linaw_session=" + raw };
}

async function makeFixture() {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const [victim, attackerA, attackerB] = await db.insert(organizations).values([
    { name: "Victim Only " + nonce, legalName: "Fictional Victim " + nonce },
    { name: "Attacker A " + nonce, legalName: "Fictional Attacker A " + nonce },
    { name: "Attacker B " + nonce, legalName: "Fictional Attacker B " + nonce },
  ]).returning({ id: organizations.id });
  const orgs = [victim, attackerA, attackerB];
  const owners = await db.insert(users).values(orgs.map((_, idx) => ({
    email: "secondpass-owner-" + idx + "-" + nonce + "@example.invalid",
    name: ["Victim Account " + nonce, "Attacker A " + nonce, "Attacker B " + nonce][idx],
    passwordHash: "fictional-session-only-no-password-login",
    role: "owner",
  }))).returning({ id: users.id, email: users.email, name: users.name });
  await db.insert(userOrganizations).values(orgs.map((org, idx) => ({
    userId: owners[idx].id, organizationId: org.id, role: "owner", active: true,
  })));
  const entities = await db.insert(legalEntities).values(orgs.map((org, idx) => ({
    organizationId: org.id, code: "QA-" + idx, legalName: "Fictional Entity " + idx,
    displayName: "Test Entity " + idx, primaryEntity: true,
  }))).returning({ id: legalEntities.id });
  const units = await db.insert(orgUnits).values([
    ...Array.from({ length: 8 }, (_, idx) => ({
      organizationId: victim.id, legalEntityId: entities[0].id,
      type: "department", code: "VICTIM-" + nonce + "-" + idx,
      name: "Victim only department " + idx,
    })),
    { organizationId: attackerA.id, legalEntityId: entities[1].id,
      type: "department", code: "ATTA-" + nonce, name: "Attacker A department" },
    { organizationId: attackerB.id, legalEntityId: entities[2].id,
      type: "department", code: "ATTB-" + nonce, name: "Attacker B department" },
  ]).returning({ id: orgUnits.id, organizationId: orgUnits.organizationId, name: orgUnits.name });
  const victimUnits = units.filter((u) => u.organizationId === victim.id);
  const ownedUnits = orgs.map((org) => units.filter((u) => u.organizationId === org.id).at(-1));
  const victimEmployees = await db.insert(employees).values(Array.from({ length: 8 }, (_, idx) => ({
    organizationId: victim.id, legalEntityId: entities[0].id,
    orgUnitId: victimUnits[idx].id, employeeNo: "V-" + nonce + "-" + idx,
    firstName: "VictimExclusive" + idx, lastName: "Synthetic", title: "Victim confidential",
    avatarInitials: "VS", basicRate: "20000.00", startDate: "2026-10-01",
  }))).returning({ id: employees.id, organizationId: employees.organizationId, employeeNo: employees.employeeNo });
  const ownedEmployees = await db.insert(employees).values([attackerA, attackerB].map((org, idx) => ({
    organizationId: org.id, legalEntityId: entities[idx + 1].id, orgUnitId: ownedUnits[idx + 1].id,
    employeeNo: "A-" + nonce + "-" + idx, firstName: "OwnEmployee" + idx,
    lastName: "Synthetic", title: "Attacker own employee", avatarInitials: "OS",
    basicRate: "18000.00", startDate: "2026-10-01",
  }))).returning({ id: employees.id });
  // Isolated per-tenant resource fixtures: always seed the victim first so
  // direct-object attempts exercise real high IDs rather than guessed 1..6.
  const syntheticAssets = await db.insert(assets).values([
    ...victimEmployees.map((employee, index) => ({
      organizationId: victim.id, employeeId: employee.id, type: "laptop",
      name: "Victim-only asset " + nonce + "-" + index,
      serialNumber: "VICTIM-" + nonce + "-" + index,
    })),
    ...ownedEmployees.map((employee, index) => ({
      organizationId: orgs[index + 1].id, employeeId: employee.id, type: "laptop",
      name: "Attacker-owned asset " + nonce + "-" + index,
      serialNumber: "OWN-" + nonce + "-" + index,
    })),
  ]).returning({ id: assets.id, organizationId: assets.organizationId, name: assets.name });
  const syntheticDocuments = await db.insert(documents).values(
    [...victimEmployees, ...ownedEmployees].map((employee, index) => {
      const own = index < 8 ? 0 : index - 7;
      const bytes = Buffer.from("FICTIONAL-DOCUMENT-" + nonce + "-" + index);
      return {
        organizationId: orgs[own].id, employeeId: employee.id,
        kind: "onboarding", fileName: "fictional-evidence-" + nonce + "-" + index + ".txt",
        mimeType: "text/plain", byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scannedClean: true, scanNote: "Synthetic metadata acceptance only",
        uploadedBy: owners[own].name, uploadedByUserId: owners[own].id,
        sourceType: "upload", content: bytes.toString("base64"),
      };
    }),
  ).returning({ id: documents.id, organizationId: documents.organizationId });
  const syntheticLeavePolicies = await db.insert(leavePolicies).values(orgs.map((org) => ({
    organizationId: org.id, leaveType: "Vacation", annualDays: "12.0",
    payTreatment: "paid", paidPercentage: "100.00", active: true,
  }))).returning({ id: leavePolicies.id, organizationId: leavePolicies.organizationId });
  const syntheticApprovalChains = await db.insert(approvalChainPolicies).values(orgs.map((org, index) => ({
    organizationId: org.id, code: "CI-" + nonce + "-" + index,
    name: "Fictional approval chain " + index,
    purpose: "automation", steps: [], active: true, createdByUserId: owners[index].id,
  }))).returning({ id: approvalChainPolicies.id, organizationId: approvalChainPolicies.organizationId });

  const scimWorkers = await db.insert(users).values([
    ...Array.from({ length: 8 }, (_, idx) => ({
      email: "victim-scim-" + idx + "-" + nonce + "@example.invalid",
      name: "VictimSCIM" + idx, passwordHash: "ci-scim-only", role: "employee",
    })),
    ...[0, 1].map((idx) => ({
      email: "attacker-scim-" + idx + "-" + nonce + "@example.invalid",
      name: "AttackerSCIM" + idx, passwordHash: "ci-scim-only", role: "employee",
    })),
  ]).returning({ id: users.id, email: users.email });
  await db.insert(userOrganizations).values(scimWorkers.map((u, idx) => ({
    userId: u.id,
    organizationId: idx < 8 ? victim.id : orgs[idx - 7].id,
    role: "employee", active: true,
  })));
  const identities = await db.insert(scimIdentities).values(scimWorkers.map((u, idx) => ({
    organizationId: idx < 8 ? victim.id : orgs[idx - 7].id,
    userId: u.id, externalId: "fictional-" + nonce + "-" + idx,
  }))).returning({ id: scimIdentities.id, organizationId: scimIdentities.organizationId });
  const tokenSets = await Promise.all(orgs.map(async (org, idx) => {
    const api = mintApiKey();
    await db.insert(apiKeys).values({
      organizationId: org.id, name: "Second-pass test " + idx,
      prefix: api.prefix, keyHash: api.keyHash,
      scopes: ["employees:read","employees:write","payroll:read","org-units:read","payslips:read","events:read"],
    });
    const scim = mintScimToken();
    await db.insert(scimTokens).values({
      organizationId: org.id, name: "Second-pass SCIM " + idx,
      prefix: scim.prefix, tokenHash: scim.tokenHash, createdByUserId: owners[idx].id,
    });
    return { bearer: api.key, scim: scim.token };
  }));
  const ownerSessions = await Promise.all(owners.map((owner) => makeSession(owner.id)));
  // Produce an actual victim-only, high-valued session ID, not a guessed 1..6 probe.
  const victimSessions = [];
  for (let idx = 0; idx < 8; idx++) victimSessions.push(await makeSession(owners[0].id));

  const runs = await db.insert(payrollRuns).values([
    ...Array.from({ length: 8 }, (_, idx) => ({
      organizationId: victim.id, legalEntityId: entities[0].id,
      periodLabel: "VICTIM-ONLY-" + idx, periodStart: "2026-10-01",
      periodEnd: "2026-10-15", payDate: "2026-10-16", status: "Released",
    })),
    ...[attackerA, attackerB].map((org, idx) => ({
      organizationId: org.id, legalEntityId: entities[idx + 1].id,
      periodLabel: "ATTACKER-" + idx, periodStart: "2026-10-01",
      periodEnd: "2026-10-15", payDate: "2026-10-16", status: "Released",
    })),
  ]).returning({ id: payrollRuns.id, organizationId: payrollRuns.organizationId });
  const victimRuns = runs.filter((r) => r.organizationId === victim.id);
  const ownRuns = orgs.map((org) => runs.filter((r) => r.organizationId === org.id).at(-1));
  const entries = await db.insert(payrollEntries).values([
    ...victimEmployees.map((emp, idx) => ({
      payrollRunId: victimRuns[idx].id, employeeId: emp.id,
      grossPay: "9000.00", deductions: "1000.00", netPay: "8000.00",
    })),
    ...ownedEmployees.map((emp, idx) => ({
      payrollRunId: ownRuns[idx + 1].id, employeeId: emp.id,
      grossPay: "5000.00", deductions: "500.00", netPay: "4500.00",
    })),
  ]).returning({ id: payrollEntries.id });
  const slips = await db.insert(payslips).values(entries.map((entry, idx) => ({
    payrollEntryId: entry.id, organizationId: idx < 8 ? victim.id : orgs[idx - 7].id,
    employeeId: idx < 8 ? victimEmployees[idx].id : ownedEmployees[idx - 8].id,
    periodLabel: "CI-2026-10",
    content: idx < 8 ? "VICTIM-EXCLUSIVE-PAYSLIP-" + nonce + "-" + idx
      : "ATTACKER-OWN-PAYSLIP-" + nonce + "-" + idx,
  }))).returning({ id: payslips.id, organizationId: payslips.organizationId });
  const events = await db.insert(providerEvents).values(runs.map((run, idx) => ({
    organizationId: run.organizationId, payrollRunId: run.id,
    provider: "linaw", eventId: "tenant-second-pass-" + nonce + "-" + idx,
    eventType: idx < 8 ? "victim.exclusive" : "attacker.own",
  }))).returning({ id: providerEvents.id, organizationId: providerEvents.organizationId });

  const highIds = [
    syntheticAssets[7].id, syntheticDocuments[7].id,
    victimEmployees.at(-1).id, victimRuns.at(-1).id,
    slips[7].id, identities[7].id, victimSessions.at(-1).id, victimUnits.at(-1).id,
  ];
  for (const id of highIds) assert.ok(Number.isSafeInteger(id) && id > 6, "Victim-only ID must really exist and exceed 6: " + id);
  assert.equal(identities[7].organizationId, victim.id);
  assert.equal(slips[7].organizationId, victim.id);
  assert.equal(events[7].organizationId, victim.id);

  return {
    orgs, owners, entities, ownedUnits, victimEmployees, ownedEmployees, identities,
    victimRuns, ownRuns, slips, events, tokenSets, ownerSessions, victimSessions,
    syntheticAssets, syntheticDocuments, syntheticLeavePolicies, syntheticApprovalChains,
    victimEmployee: victimEmployees.at(-1), victimIdentity: identities[7],
    victimScimEmail: scimWorkers[7].email,
    victimSlip: slips[7], victimRun: victimRuns.at(-1), victimUnit: victimUnits.at(-1),
  };
}

async function baselineProbeAllMethods(f) {
  const publicCases = new Set([
    "GET auth/me", "POST auth/logout", "POST auth/sso/resolve",
    "GET scim/v2/ServiceProviderConfig", "GET v1",
  ]);
  const strongUnauthorized = new Set([
    "GET scim/v2/Users", "POST scim/v2/Users",
    "GET scim/v2/Users/[id]", "PATCH scim/v2/Users/[id]", "DELETE scim/v2/Users/[id]",
    "GET jobs/admin-status", "GET jobs/dispatch-readiness", "POST jobs/tick",
    "POST webhooks/drain",
  ]);
  let probed = 0;
  for (const [route, declared] of Object.entries(SECOND_PASS_ROUTES)) {
    for (const method of declared.split(" ")) {
      const path = "/api/" + route.replaceAll("[id]", String(f.victimIdentity.id))
        .replaceAll("[providerId]", "99999999");
      const target = route.startsWith("v1/") && route.includes("[id]")
        ? "/api/" + route.replaceAll("[id]", String(f.victimEmployee.id)) : path;
      const result = await request(target, {
        method, body: method === "GET" ? undefined : {
          organizationId: f.orgs[0].id, userId: f.owners[0].id, id: f.victimEmployee.id,
          employeeId: f.victimEmployee.id, token: "invalid",
        },
      });
      const key = method + " " + route;
      if (strongUnauthorized.has(key)) {
        expectStatus(result, 401, "Anonymous credential boundary " + key);
      } else if (key.startsWith("GET v1/") || key.startsWith("POST v1/")
        || key.startsWith("PATCH v1/") || key.startsWith("DELETE v1/")) {
        // All v1 protected routes must be authenticated in this isolated CI run.
        // Both extension release flags are intentionally ON in the localhost process.
        expectStatus(result, 401, "Anonymous API key boundary " + key);
      } else if (publicCases.has(key)) {
        expectStatus(result, 200, "Intentionally public/auth-status endpoint " + key);
      } else if (route.startsWith("webhooks/") && route !== "webhooks/drain") {
        expectStatus(result, 401, "Bad provider signature must be denied " + key);
      } else {
        assert.ok(
          [400,401,403,404,409,422,503].includes(result.status),
          "Invalid/unauthenticated " + key + " unexpectedly succeeded: HTTP " + result.status,
        );
        assert.ok(result.json && typeof result.json === "object",
          "Invalid/unauthenticated " + key + " must return handler JSON, not an unrouted 404 page");
        assertions++;
      }
      probed++;
    }
  }
  assert.ok(probed >= 50 && SECOND_PASS_FAMILIES.length === 6);
  console.log("PASS second-pass route inventory: " + probed + " actual HTTP method probes in six omitted families");
}

async function verifyCrossTenant(f) {
  const victim = f.orgs[0];
  const tokenV = f.tokenSets[0];
  const checkVictimId = f.victimEmployee.id;

  expectStatus(await request("/api/v1/employees/" + checkVictimId, { bearer: tokenV.bearer }), 200,
    "Victim's own exclusive employee must exist");
  expectStatus(await request("/api/scim/v2/Users/" + f.victimIdentity.id, { scim: tokenV.scim }), 200,
    "Victim SCIM identity must exist");
  const victimFilter = list(await request("/api/scim/v2/Users?filter=" +
    encodeURIComponent('userName eq "' + f.victimScimEmail + '"'), {
      scim: tokenV.scim,
    }), "Resources", "Victim SCIM email filter positive control");
  ownOnly(victimFilter, f.victimIdentity.id, [], "Victim SCIM filter must find its own identity");
  expectStatus(await request("/api/v1/payslips/" + f.victimSlip.id, { bearer: tokenV.bearer }), 200,
    "Victim-only payslip must be readable with victim credential");

  const victimEmployeeBefore = (await db.select().from(employees)
    .where(and(eq(employees.id, checkVictimId),eq(employees.organizationId,victim.id))))[0];
  const victimScimBefore = (await db.select().from(scimIdentities)
    .where(eq(scimIdentities.id, f.victimIdentity.id)))[0];
  const victimScimIdsBefore = (await db.select({ id: scimIdentities.id }).from(scimIdentities)
    .where(eq(scimIdentities.organizationId, victim.id))).map((r) => r.id).sort((a,b) => a-b);
  const victimEmployeeIdsBefore = (await db.select({ id: employees.id }).from(employees)
    .where(eq(employees.organizationId, victim.id))).map((r) => r.id).sort((a,b) => a-b);
  const victimOwnerBefore = (await db.select().from(users).where(eq(users.id, f.owners[0].id)))[0];
  const victimAssetsBefore = await db.select().from(assets)
    .where(eq(assets.organizationId, victim.id)).orderBy(assets.id);
  const victimDocumentsBefore = await db.select().from(documents)
    .where(eq(documents.organizationId, victim.id)).orderBy(documents.id);
  const eventIdsBefore = (await db.select().from(providerEvents)
    .where(eq(providerEvents.organizationId, victim.id))).map((e) => e.id).sort((a,b) => a-b);

  for (const idx of [1, 2]) {
    const attacker = f.orgs[idx];
    const creds = f.tokenSets[idx];
    const owner = f.owners[idx];
    const attackerCookie = f.ownerSessions[idx].cookie;
    const ownEmployee = f.ownedEmployees[idx - 1].id;
    const ownIdentity = f.identities[8 + idx - 1].id;
    const ownSlip = f.slips[8 + idx - 1].id;
    const ownRun = f.ownRuns[idx].id;
    const ownUnit = f.ownedUnits[idx].id;

    const ownAccount = expectStatus(await request("/api/account", { cookie: attackerCookie }), 200,
      "Attacker " + idx + " must have a valid authenticated account");
    assert.equal(ownAccount.json.profile.id, owner.id);
    const me = expectStatus(await request("/api/auth/me", { cookie: attackerCookie }), 200,
      "Attacker " + idx + " must have a valid auth session");
    assert.equal(me.json.user.id, owner.id);
    const ownEmployeeRead = expectStatus(await request("/api/v1/employees/" + ownEmployee, {
      bearer: creds.bearer,
    }), 200, "Attacker " + idx + " API key own employee");
    assert.equal(ownEmployeeRead.json.id, ownEmployee);
    const ownScimRead = expectStatus(await request("/api/scim/v2/Users/" + ownIdentity, {
      scim: creds.scim,
    }), 200, "Attacker " + idx + " SCIM key own identity");
    assert.equal(Number(ownScimRead.json.id), ownIdentity);
    expectStatus(await request("/api/v1/payslips/" + ownSlip, { bearer: creds.bearer }), 200,
      "Attacker " + idx + " payslip own control");

    // Three-tenant real-HTTP read proof, against two independent attacker sessions.
    // Each successful request must resolve seeded own records BEFORE the denial
    // assertions; an empty/unauthenticated response cannot count as isolation.
    const ownDashboard = expectStatus(await request("/api/dashboard?organizationId=" + attacker.id, { cookie: attackerCookie }), 200,
      "Attacker " + idx + " owns the requested dashboard");
    assert.equal(ownDashboard.json?.selectedOrganization?.id, attacker.id,
      "Dashboard must not silently switch to another employer");
    assert.ok(Array.isArray(ownDashboard.json?.employees) &&
      ownDashboard.json.employees.some((row) => row.id === ownEmployee),
      "Dashboard must expose the seeded own employee as positive proof");
    assert.ok(!ownDashboard.json.employees.some((row) => f.victimEmployees.some((v) => v.id === row.id)),
      "Dashboard leaked a victim-only employee");
    expectStatus(await request("/api/dashboard?organizationId=" + victim.id, { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not read the victim dashboard");

    const ownDirectory = expectStatus(await request("/api/employees?organizationId=" + attacker.id, { cookie: attackerCookie }), 200,
      "Attacker " + idx + " owns employee directory");
    assert.ok(Array.isArray(ownDirectory.json), "Employee directory positive must return real rows");
    ownOnly(ownDirectory.json, ownEmployee, f.victimEmployees.map((v) => v.id),
      "Attacker " + idx + " employee directory must exclude every victim-only worker");
    assert.ok(ownDirectory.json.every((row) => row.organizationId === attacker.id),
      "Employee directory must not return another organization's staff");
    expectStatus(await request("/api/employees?organizationId=" + victim.id, { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not list the victim directory");

    const ownRunList = expectStatus(await request("/api/payroll-runs?organizationId=" + attacker.id, { cookie: attackerCookie }), 200,
      "Attacker " + idx + " owns payroll run list");
    assert.ok(Array.isArray(ownRunList.json?.runs), "Payroll run list positive must return a real array");
    ownOnly(ownRunList.json.runs, ownRun, f.victimRuns.map((r) => r.id),
      "Attacker " + idx + " payroll runs must exclude victim-only runs");
    assert.ok(ownRunList.json.runs.every((run) => run.organizationId === attacker.id),
      "Payroll run list leaked a foreign-employer payroll record");
    expectStatus(await request("/api/payroll-runs?organizationId=" + victim.id, { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not list victim payroll runs");
    expectStatus(await request("/api/payroll-runs?organizationId=" + attacker.id +
      "&runId=" + f.victimRun.id + "&include=entries", { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not read a victim-only run register through a forged employer ID");

    // Every additional GET requires a real own row, plus a foreign-org denial.
    const ownAssetsResult = expectStatus(await request("/api/assets?organizationId=" + attacker.id, { cookie: attackerCookie }), 200,
      "Attacker " + idx + " asset inventory own-positive");
    assert.ok(Array.isArray(ownAssetsResult.json), "Assets GET must return a real array");
    ownOnly(ownAssetsResult.json, f.syntheticAssets[8 + idx - 1].id,
      f.syntheticAssets.slice(0, 8).map((asset) => asset.id), "Assets list must exclude victim-only assets");
    assert.ok(ownAssetsResult.json.every((row) => row.organizationId === attacker.id),
      "Asset list must remain in the caller's employer");
    expectStatus(await request("/api/assets?organizationId=" + victim.id, { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not read victim-only asset inventory");

    const ownDocumentsResult = expectStatus(await request("/api/documents?organizationId=" + attacker.id, { cookie: attackerCookie }), 200,
      "Attacker " + idx + " document metadata own-positive");
    ownOnly(ownDocumentsResult.json.documents, f.syntheticDocuments[8 + idx - 1].id,
      f.syntheticDocuments.slice(0, 8).map((doc) => doc.id), "Document metadata must exclude victim-only files");
    expectStatus(await request("/api/documents?organizationId=" + victim.id, { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not read victim document metadata");

    const ownApprovalsResult = expectStatus(await request("/api/approval-chains?organizationId=" + attacker.id, { cookie: attackerCookie }), 200,
      "Attacker " + idx + " approval policy own-positive");
    ownOnly(ownApprovalsResult.json.policies, f.syntheticApprovalChains[idx].id,
      [f.syntheticApprovalChains[0].id], "Approval policies must exclude victim-only policy");
    expectStatus(await request("/api/approval-chains?organizationId=" + victim.id, { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not read victim approval policies");

    const ownLeaveResult = expectStatus(await request("/api/leave/balances?organizationId=" + attacker.id + "&asOf=2026-10-19", { cookie: attackerCookie }), 200,
      "Attacker " + idx + " leave balance own-positive");
    ownOnly(ownLeaveResult.json.balances, ownEmployee,
      f.victimEmployees.map((worker) => worker.id), "Leave balances must exclude victim-only workers", "employeeId");
    assert.ok(ownLeaveResult.json.policies.some((policy) => policy.id === f.syntheticLeavePolicies[idx].id),
      "The own employer must have a real seeded leave policy");
    expectStatus(await request("/api/leave/balances?organizationId=" + victim.id + "&asOf=2026-10-19", { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not read victim leave balances");

    const ownComplianceResult = expectStatus(await request("/api/compliance/calendar?organizationId=" + attacker.id, { cookie: attackerCookie }), 200,
      "Attacker " + idx + " statutory calendar own-positive");
    assert.ok(Array.isArray(ownComplianceResult.json?.applicableMonths) &&
      ownComplianceResult.json.applicableMonths.includes("2026-10") &&
      Array.isArray(ownComplianceResult.json.items),
      "Calendar must be backed by the caller's real seeded payroll period");
    expectStatus(await request("/api/compliance/calendar?organizationId=" + victim.id, { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not read victim statutory calendar");

    // Asset POST/PATCH/DELETE: positive owned changes, then real foreign-ID
    // denials, including a forged organizationId and a real victim employeeId.
    const ownCreatedAsset = expectStatus(await request("/api/assets", {
      method: "POST", cookie: attackerCookie,
      body: { organizationId: attacker.id, employeeId: ownEmployee,
        type: "laptop", name: "Fictional owned-created asset " + idx },
    }), 201, "Attacker " + idx + " must create an asset only in its own employer");
    const [createdAssetRow] = await db.select().from(assets)
      .where(eq(assets.id, ownCreatedAsset.json.id));
    assert.equal(createdAssetRow.organizationId, attacker.id,
      "POST must persist only against the authorized owning employer");
    expectStatus(await request("/api/assets", {
      method: "POST", cookie: attackerCookie,
      body: { organizationId: victim.id, employeeId: f.victimEmployee.id,
        type: "laptop", name: "FORGED VICTIM ASSET" },
    }), 403, "Attacker " + idx + " must not POST a victim asset");
    expectStatus(await request("/api/assets", {
      method: "POST", cookie: attackerCookie,
      body: { organizationId: attacker.id, employeeId: f.victimEmployee.id,
        type: "laptop", name: "FORGED VICTIM WORKER" },
    }), 404, "Attacker " + idx + " must not bind a victim-only employee");

    const ownPatchedAsset = expectStatus(await request("/api/assets", {
      method: "PATCH", cookie: attackerCookie,
      body: { id: f.syntheticAssets[8 + idx - 1].id,
        name: "Fictional owned-updated asset " + idx },
    }), 200, "Attacker " + idx + " may edit its own seeded asset");
    assert.equal(ownPatchedAsset.json.organizationId, attacker.id);
    expectStatus(await request("/api/assets", {
      method: "PATCH", cookie: attackerCookie,
      body: { id: f.syntheticAssets[7].id, organizationId: attacker.id,
        name: "FORGED VICTIM ASSET PATCH" },
    }), 403, "Attacker " + idx + " must not PATCH a real victim-only asset");

    const ownDeletedAsset = expectStatus(await request("/api/assets?id=" + ownCreatedAsset.json.id, {
      method: "DELETE", cookie: attackerCookie,
    }), 200, "Attacker " + idx + " may delete the disposable own-created asset");
    assert.equal(ownDeletedAsset.json.success, true);
    const [stillCreated] = await db.select().from(assets)
      .where(eq(assets.id, ownCreatedAsset.json.id));
    assert.equal(stillCreated, undefined, "Own DELETE must actually remove a real own asset");
    expectStatus(await request("/api/assets?id=" + f.syntheticAssets[7].id, {
      method: "DELETE", cookie: attackerCookie,
    }), 403, "Attacker " + idx + " must not DELETE a real victim-only asset");

    expectStatus(await request("/api/v1/employees/" + checkVictimId, { bearer: creds.bearer }), 404,
      "Attacker " + idx + " must not GET victim employee");
    const ownV1Patch = expectStatus(await request("/api/v1/employees/" + ownEmployee, {
      method: "PATCH", bearer: creds.bearer,
      body: { title: "Fictional own-tenant profile patch " + idx },
    }), 200, "Attacker " + idx + " must PATCH only its own employee");
    assert.equal(ownV1Patch.json.id, ownEmployee);
    assert.equal(ownV1Patch.json.organizationId, attacker.id);

    expectStatus(await request("/api/v1/employees/" + checkVictimId, {
      bearer: creds.bearer, method: "PATCH",
      body: { title: "UNAUTHORIZED CHANGE", organizationId: victim.id },
    }), 404, "Attacker " + idx + " must not PATCH victim employee");
    expectStatus(await request("/api/v1/employees/" + checkVictimId, {
      bearer: creds.bearer, method: "DELETE", body: { organizationId: victim.id },
    }), 404, "Attacker " + idx + " must not DELETE victim employee");
    const employeeList = list(await request("/api/v1/employees?limit=100&organizationId=" + victim.id, {
      bearer: creds.bearer,
    }), "data", "Attacker " + idx + " forged employee list");
    ownOnly(employeeList, ownEmployee, f.victimEmployees.map((e) => e.id),
      "Attacker " + idx + " employee list");

    // ID-in-body creation must be bound to bearer key's tenant, not request JSON.
    const create = expectStatus(await request("/api/v1/employees", {
      method: "POST", bearer: creds.bearer,
      body: {
        organizationId: victim.id, firstName: "ForgedTenant" + idx,
        lastName: "Fixture", title: "Read-only acceptance fixture",
        basicRate: 15000, startDate: "2026-10-01",
        employeeNo: "CI-CROSS-ATTACK-" + idx + "-" + owner.id,
      },
    }), 201, "Attacker " + idx + " API employee creation must be scoped to caller");
    const [created] = await db.select().from(employees).where(eq(employees.id, create.json.id));
    assert.equal(created.organizationId, attacker.id,
      "Attacker " + idx + " body organizationId must be ignored in favor of API token");

    const ownV1Delete = expectStatus(await request("/api/v1/employees/" + created.id, {
      method: "DELETE", bearer: creds.bearer,
    }), 200, "Attacker " + idx + " must offboard only its own new fictional employee");
    assert.equal(ownV1Delete.json.id, created.id);
    assert.equal(ownV1Delete.json.status, "Separating");
    const [separatedOwn] = await db.select().from(employees).where(eq(employees.id, created.id));
    assert.equal(separatedOwn.organizationId, attacker.id);
    assert.equal(separatedOwn.status, "Separating");

    expectStatus(await request("/api/scim/v2/Users/" + f.victimIdentity.id, {
      scim: creds.scim,
    }), 404, "Attacker " + idx + " must not GET victim SCIM identity");
    const ownScimPatch = expectStatus(await request("/api/scim/v2/Users/" + ownIdentity, {
      method: "PATCH", scim: creds.scim,
      body: { Operations: [{ op: "replace", path: "displayName",
        value: "Fictional own-tenant SCIM profile " + idx }] },
    }), 200, "Attacker " + idx + " must PATCH only its own SCIM identity");
    assert.equal(Number(ownScimPatch.json.id), ownIdentity);
    assert.equal(ownScimPatch.json.displayName, "Fictional own-tenant SCIM profile " + idx);

    expectStatus(await request("/api/scim/v2/Users/" + f.victimIdentity.id, {
      method: "PATCH", scim: creds.scim,
      body: { Operations: [{ op: "replace", path: "active", value: false }],
        organizationId: victim.id },
    }), 404, "Attacker " + idx + " must not PATCH victim SCIM identity");
    expectStatus(await request("/api/scim/v2/Users/" + f.victimIdentity.id, {
      method: "DELETE", scim: creds.scim,
    }), 404, "Attacker " + idx + " must not DELETE victim SCIM identity");
    const scimList = list(await request("/api/scim/v2/Users?count=100", {
      scim: creds.scim,
    }), "Resources", "Attacker " + idx + " SCIM list");
    ownOnly(scimList, ownIdentity, [f.victimIdentity.id], "Attacker " + idx + " SCIM list");

    const victimEmailFilter = 'userName eq "' + f.victimScimEmail + '"';
    const scimFilter = list(await request("/api/scim/v2/Users?filter=" +
      encodeURIComponent(victimEmailFilter), { scim: creds.scim,
    }), "Resources", "Attacker " + idx + " victim email SCIM filter");
    assert.equal(scimFilter.length, 0, "Victim email must never be resolved into attacker SCIM scope");

    // A SCIM bearer must not be able to bind a victim-only employee via an
    // enterprise extension, even if the body names the victim organization.
    expectStatus(await request("/api/scim/v2/Users", {
      method: "POST", scim: creds.scim,
      body: {
        userName: "foreign-scim-" + idx + "-" + owner.id + "@example.invalid",
        displayName: "Cross-org binding rejected",
        externalId: "foreign-test-" + owner.id,
        organizationId: victim.id,
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
          employeeNumber: f.victimEmployee.employeeNo,
        },
      },
    }), 404, "Attacker " + idx + " SCIM POST cannot bind victim employeeNumber");

    const ownScimCreate = expectStatus(await request("/api/scim/v2/Users", {
      method: "POST", scim: creds.scim,
      body: {
        userName: "own-scim-" + idx + "-" + owner.id + "@example.invalid",
        displayName: "Own fictional SCIM provisioning",
        externalId: "own-test-" + owner.id,
        organizationId: victim.id,
        // SCIM correctly refuses unscoped, company-wide new memberships.
        // Prove the positive path using a department owned by this bearer org.
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
          department: f.ownedUnits[idx].name,
        },
      },
    }), 201, "Attacker " + idx + " can provision only its own scoped SCIM organization");
    const [scimCreated] = await db.select().from(scimIdentities)
      .where(eq(scimIdentities.id, Number(ownScimCreate.json.id)));
    assert.equal(scimCreated.organizationId, attacker.id,
      "SCIM caller's bearer, not attacker-supplied organizationId, must choose the target org");
    const [createdMembership] = await db.select().from(userOrganizations).where(and(
      eq(userOrganizations.userId, scimCreated.userId),
      eq(userOrganizations.organizationId, attacker.id),
    ));
    assert.equal(createdMembership?.orgUnitId, ownUnit,
      "SCIM must not grant unscoped company-wide access or accept a victim department");

    const ownScimDelete = expectStatus(await request("/api/scim/v2/Users/" + Number(ownScimCreate.json.id), {
      method: "DELETE", scim: creds.scim,
    }), 204, "Attacker " + idx + " must deactivate only its own new SCIM account");
    const [deactivatedOwn] = await db.select().from(scimIdentities)
      .where(eq(scimIdentities.id, Number(ownScimCreate.json.id)));
    assert.equal(deactivatedOwn.organizationId, attacker.id);
    assert.equal(deactivatedOwn.active, false);

    const ownSessions = list(await request("/api/account/sessions", {
      cookie: attackerCookie,
    }), "sessions", "Attacker " + idx + " account sessions");
    assert.ok(ownSessions.some((s) => s.id === f.ownerSessions[idx].id));
    assert.ok(!ownSessions.some((s) => s.id === f.victimSessions.at(-1).id));
    const disposableOwnSession = await makeSession(owner.id);
    const ownSessionDelete = expectStatus(await request("/api/account/sessions", {
      method: "DELETE", cookie: attackerCookie, body: { id: disposableOwnSession.id },
    }), 200, "Attacker " + idx + " may revoke its own disposable session");
    assert.equal(ownSessionDelete.json.revoked, 1);
    const [revokedOwn] = await db.select().from(sessions).where(eq(sessions.id, disposableOwnSession.id));
    assert.ok(revokedOwn.revokedAt !== null, "Own session revocation must persist");

    expectStatus(await request("/api/account/sessions", {
      method: "DELETE", cookie: attackerCookie,
      body: { id: f.victimSessions.at(-1).id, organizationId: victim.id },
    }), 404, "Attacker " + idx + " must not revoke victim-only session");

    const spoofProfile = expectStatus(await request("/api/account/profile", {
      method: "POST", cookie: attackerCookie,
      body: { userId: f.owners[0].id, organizationId: victim.id,
        name: "Attacker Own Profile " + idx },
    }), 200, "Account change may only rename the authenticated user");
    assert.equal(spoofProfile.json.name, "Attacker Own Profile " + idx);
    const [nameRow] = await db.select({ name: users.name }).from(users).where(eq(users.id, owner.id));
    assert.equal(nameRow.name, "Attacker Own Profile " + idx);

    const ownAdmin = expectStatus(await request("/api/jobs/admin-status?organizationId=" + attacker.id, {
      cookie: attackerCookie,
    }), 200, "Attacker " + idx + " own scheduler read is authorized");
    assert.equal(typeof ownAdmin.json.state, "string");
    expectStatus(await request("/api/jobs/admin-status?organizationId=" + victim.id, {
      cookie: attackerCookie,
    }), 403, "Attacker " + idx + " must not choose victim org's scheduler status");

    const runs = list(await request("/api/v1/payroll-runs?organizationId=" + victim.id, {
      bearer: creds.bearer,
    }), "data", "Attacker " + idx + " payroll run list");
    ownOnly(runs, ownRun, f.victimRuns.map((r) => r.id), "Attacker " + idx + " payroll runs");

    const units = list(await request("/api/v1/org-units?organizationId=" + victim.id, {
      bearer: creds.bearer,
    }), "data", "Attacker " + idx + " org-unit list");
    ownOnly(units, ownUnit, [f.victimUnit.id], "Attacker " + idx + " org units");

    const payslips = list(await request("/api/v1/payslips?organizationId=" + victim.id, {
      bearer: creds.bearer,
    }), "data", "Attacker " + idx + " payslip list");
    ownOnly(payslips, ownSlip, [f.victimSlip.id], "Attacker " + idx + " payslips");
    expectStatus(await request("/api/v1/payslips/" + f.victimSlip.id, {
      bearer: creds.bearer,
    }), 404, "Attacker " + idx + " victim-only payslip direct URL");

    const events = list(await request("/api/v1/events?organizationId=" + victim.id, {
      bearer: creds.bearer,
    }), "data", "Attacker " + idx + " outbound event feed");
    assert.ok(events.some((e) => e.eventType === "attacker.own"),
      "Attacker event feed must have own fixture");
    assert.ok(events.every((e) => e.eventType !== "victim.exclusive"),
      "Attacker event feed exposed victim event");
    const inbox = list(await request("/api/v1/provider-events?organizationId=" + victim.id, {
      bearer: creds.bearer,
    }), "data", "Attacker " + idx + " inbound provider feed");
    assert.ok(inbox.some((e) => e.id === f.events[8 + idx - 1].id),
      "Attacker must see own verified provider receipt");
    assert.ok(!inbox.some((e) => f.events.slice(0,8).some((v) => v.id === e.id)),
      "Attacker leaked victim provider receipt");
    expectStatus(await request("/api/v1/journal-entries?startDate=2026-10-01&endDate=2026-10-31&legalEntityId="
      + f.entities[0].id, { bearer: creds.bearer,
    }), 403, "Attacker " + idx + " must not select victim legal employer journal");

    console.log("PASS second-pass real HTTP attacker-" + idx +
      ": own credential controls, victim-only high IDs, SCIM, v1, account, jobs and mutations");
  }

  const victimAssetsAfter = await db.select().from(assets)
    .where(eq(assets.organizationId, victim.id)).orderBy(assets.id);
  const victimDocumentsAfter = await db.select().from(documents)
    .where(eq(documents.organizationId, victim.id)).orderBy(documents.id);
  const victimEmployeeAfter = (await db.select().from(employees)
    .where(eq(employees.id, checkVictimId)))[0];
  const victimScimAfter = (await db.select().from(scimIdentities)
    .where(eq(scimIdentities.id, f.victimIdentity.id)))[0];
  const victimScimIdsAfter = (await db.select({ id: scimIdentities.id }).from(scimIdentities)
    .where(eq(scimIdentities.organizationId, victim.id))).map((r) => r.id).sort((a,b) => a-b);
  const victimEmployeeIdsAfter = (await db.select({ id: employees.id }).from(employees)
    .where(eq(employees.organizationId, victim.id))).map((r) => r.id).sort((a,b) => a-b);
  const victimOwnerAfter = (await db.select().from(users)
    .where(eq(users.id, f.owners[0].id)))[0];
  const victimSessionsAfter = (await db.select().from(sessions)
    .where(eq(sessions.id, f.victimSessions.at(-1).id)))[0];
  const victimEventsAfter = (await db.select().from(providerEvents)
    .where(eq(providerEvents.organizationId, victim.id))).map((e) => e.id).sort((a,b) => a-b);

  assert.deepEqual(victimAssetsAfter, victimAssetsBefore,
    "Victim asset rows must remain byte-for-byte unchanged after denied foreign POST/PATCH/DELETE");
  assert.deepEqual(victimDocumentsAfter, victimDocumentsBefore,
    "Victim document metadata and content must remain unchanged after foreign read attempts");
  assert.deepEqual(victimEmployeeAfter, victimEmployeeBefore,
    "Cross-tenant employee PATCH/DELETE must have no victim side effects");
  assert.deepEqual(victimScimAfter, victimScimBefore,
    "Cross-tenant SCIM PATCH/DELETE must not alter victim identity");
  assert.deepEqual(victimScimIdsAfter, victimScimIdsBefore,
    "Cross-tenant SCIM POST must not add a victim identity");
  assert.deepEqual(victimEmployeeIdsAfter, victimEmployeeIdsBefore,
    "Forged API employee POST must not add a victim employee");
  assert.deepEqual(victimOwnerAfter, victimOwnerBefore,
    "Account profile spoof must not modify victim user");
  assert.equal(victimSessionsAfter.revokedAt, null, "Victim-only session must remain active");
  assert.deepEqual(victimEventsAfter, eventIdsBefore,
    "Unsigned/mismatched webhook bodies may not insert victim provider receipts");
  assertions += 5;
}


/**
 * Additional real HTTP acceptance on the SAME disposable, three-employer
 * fixture. No parallel fake-request harness, production data or provider calls.
 * A seeded attacker-owned resource succeeds before any victim-only denial.
 */
async function verifySensitiveTenantDownloadsAndRoles(f) {
  const victim = f.orgs[0];
  const victimDocumentsBefore = await db.select().from(documents)
    .where(eq(documents.organizationId, victim.id)).orderBy(documents.id);
  const victimLeavePoliciesBefore = await db.select().from(leavePolicies)
    .where(eq(leavePolicies.organizationId, victim.id)).orderBy(leavePolicies.id);
  const victimLegalEntitiesBefore = await db.select().from(legalEntities)
    .where(eq(legalEntities.organizationId, victim.id)).orderBy(legalEntities.id);
  const [victimEntry] = await db.select({ id: payrollEntries.id }).from(payrollEntries)
    .where(and(eq(payrollEntries.payrollRunId, f.victimRun.id),
      eq(payrollEntries.employeeId, f.victimEmployee.id))).limit(1);
  assert.ok(victimEntry && victimEntry.id > 6,
    "Direct PDF denial needs a REAL victim-only payroll entry ID greater than six");

  for (const idx of [1, 2]) {
    const attacker = f.orgs[idx];
    const attackerCookie = f.ownerSessions[idx].cookie;
    const ownEmployeeId = f.ownedEmployees[idx - 1].id;
    const ownDocId = f.syntheticDocuments[8 + idx - 1].id;
    const victimDocId = f.syntheticDocuments[7].id;
    const [storedOwnDoc] = await db.select().from(documents)
      .where(and(eq(documents.id, ownDocId), eq(documents.organizationId, attacker.id)));
    assert.ok(storedOwnDoc?.scannedClean, "A real owned, clean document is required");

    const ownDocumentDownload = expectStatus(await request("/api/documents/" + ownDocId + "?download=1", {
      cookie: attackerCookie,
    }), 200, "Attacker " + idx + " may download a real own-employer attachment");
    assert.equal(ownDocumentDownload.text, Buffer.from(storedOwnDoc.content, "base64").toString("utf8"),
      "Document own-positive must return actual seeded bytes, not a successful empty response");
    assert.match(ownDocumentDownload.headers.get("content-disposition") ?? "", /^attachment;/);
    expectStatus(await request("/api/documents/" + victimDocId + "?download=1", {
      cookie: attackerCookie,
    }), 403, "Attacker " + idx + " must not download existing victim-only document bytes");
    expectStatus(await request("/api/documents/" + victimDocId, {
      cookie: attackerCookie,
    }), 403, "Attacker " + idx + " must not view existing victim-only document inline");

    const ownLegalEntities = expectStatus(await request("/api/legal-entities?organizationId=" +
      attacker.id + "&mode=selector", { cookie: attackerCookie }), 200,
      "Attacker " + idx + " may select only its own legal employer");
    ownOnly(ownLegalEntities.json?.legalEntities, f.entities[idx].id, [f.entities[0].id],
      "Legal employer selector must exclude a real victim legal entity");
    expectStatus(await request("/api/legal-entities?organizationId=" +
      victim.id + "&mode=selector", { cookie: attackerCookie }), 403,
      "Attacker " + idx + " must not select a victim legal employer");

    const ownLeavePolicy = expectStatus(await request("/api/leave/balances", {
      method: "POST", cookie: attackerCookie,
      body: { organizationId: attacker.id, leaveType: "Fictional QA policy " + f.owners[idx].id,
        annualDays: 9, payTreatment: "paid" },
    }), 201, "Attacker " + idx + " must create an owned leave policy before foreign denial");
    const [createdPolicy] = await db.select().from(leavePolicies)
      .where(eq(leavePolicies.id, ownLeavePolicy.json?.id));
    assert.equal(createdPolicy?.organizationId, attacker.id,
      "Owned leave policy POST must persist in the actual caller's employer");
    expectStatus(await request("/api/leave/balances", {
      method: "POST", cookie: attackerCookie,
      body: { organizationId: victim.id, leaveType: "FORGED VICTIM POLICY " + idx,
        annualDays: 9, payTreatment: "paid" },
    }), 403, "Attacker " + idx + " must not create or change a victim leave policy");

    // A genuine employee-role account, bound to a real owned worker, is needed:
    // an invalid/unlinked user yielding 401 or 403 proves nothing about pay.
    const [employeeAccount] = await db.insert(users).values({
      email: "fictional-ess-" + idx + "-" + f.owners[idx].id + "@example.invalid",
      name: "Fictional own employee " + idx,
      passwordHash: "fixture-only-no-password-login", role: "employee",
      employeeId: ownEmployeeId,
    }).returning({ id: users.id });
    await db.insert(userOrganizations).values({
      userId: employeeAccount.id, organizationId: attacker.id,
      role: "employee", active: true,
    });
    const employeeCookie = (await makeSession(employeeAccount.id)).cookie;
    const [coworker] = await db.insert(employees).values({
      organizationId: attacker.id, legalEntityId: f.entities[idx].id,
      orgUnitId: f.ownedUnits[idx].id,
      employeeNo: "CI-COWORKER-" + idx + "-" + employeeAccount.id,
      firstName: "FictionalCoworker", lastName: "Private",
      title: "Separate owned worker", avatarInitials: "FC",
      basicRate: "19000.00", startDate: "2026-10-01",
    }).returning({ id: employees.id });
    const [coworkerEntry] = await db.insert(payrollEntries).values({
      payrollRunId: f.ownRuns[idx].id, employeeId: coworker.id,
      grossPay: "6000.00", deductions: "500.00", netPay: "5500.00",
    }).returning({ id: payrollEntries.id });
    const otherBytes = Buffer.from("SYNTHETIC-COWORKER-PRIVATE-" + coworker.id);
    const [coworkerDoc] = await db.insert(documents).values({
      organizationId: attacker.id, employeeId: coworker.id, kind: "onboarding",
      fileName: "fictional-coworker-" + coworker.id + ".txt", mimeType: "text/plain",
      byteSize: otherBytes.byteLength, sha256: createHash("sha256").update(otherBytes).digest("hex"),
      scannedClean: true, scanNote: "Synthetic tenant-role fixture",
      uploadedBy: f.owners[idx].name, uploadedByUserId: f.owners[idx].id,
      sourceType: "upload", content: otherBytes.toString("base64"),
    }).returning({ id: documents.id });
    const [ownEntry] = await db.select({ id: payrollEntries.id }).from(payrollEntries)
      .where(and(eq(payrollEntries.payrollRunId, f.ownRuns[idx].id),
        eq(payrollEntries.employeeId, ownEmployeeId))).limit(1);
    assert.ok(ownEntry, "ESS positive control needs a real Released, own-worker payroll entry");

    const ownPayslipPdf = expectStatus(await request("/api/self/payslips/" + ownEntry.id, {
      cookie: employeeCookie,
    }), 200, "Employee " + idx + " must download a real own payslip PDF");
    assert.match(ownPayslipPdf.headers.get("content-type") ?? "", /^application\/pdf/);
    assert.ok(ownPayslipPdf.text.startsWith("%PDF-"), "Own payslip download must contain real PDF bytes");
    expectStatus(await request("/api/self/payslips/" + victimEntry.id, {
      cookie: employeeCookie,
    }), 404, "Employee " + idx + " must not fetch victim-employer payroll PDF by real high entry ID");
    expectStatus(await request("/api/self/payslips/" + coworkerEntry.id, {
      cookie: employeeCookie,
    }), 404, "Employee " + idx + " must not fetch a coworker's payroll PDF in the SAME employer");

    const ownSelfService = expectStatus(await request("/api/self/payslips?organizationId=" +
      victim.id, { cookie: employeeCookie }), 200,
      "Employee " + idx + " self-service must ignore forged victim organizationId");
    assert.equal(ownSelfService.json?.employee?.id, ownEmployeeId);
    assert.equal(ownSelfService.json?.employer?.id, attacker.id);
    ownOnly(ownSelfService.json?.payslips, ownEntry.id, [victimEntry.id, coworkerEntry.id],
      "ESS list must exclude another employer and same-employer coworkers", "entryId");

    const ownWorkerDocument = expectStatus(await request("/api/documents/" + ownDocId + "?download=1", {
      cookie: employeeCookie,
    }), 200, "Employee " + idx + " may download own clean file");
    assert.equal(ownWorkerDocument.text, Buffer.from(storedOwnDoc.content, "base64").toString("utf8"));
    expectStatus(await request("/api/documents/" + coworkerDoc.id + "?download=1", {
      cookie: employeeCookie,
    }), 404, "Employee " + idx + " must not download SAME-employer coworker document");
    expectStatus(await request("/api/documents/" + victimDocId + "?download=1", {
      cookie: employeeCookie,
    }), 404, "Employee " + idx + " must not download victim employer document");

    const ownEmployeeBalances = expectStatus(await request("/api/leave/balances?organizationId=" +
      attacker.id + "&asOf=2026-10-19", { cookie: employeeCookie }), 200,
      "Employee " + idx + " must have a real own leave balance before denial");
    ownOnly(ownEmployeeBalances.json?.balances, ownEmployeeId,
      [coworker.id, f.victimEmployee.id], "Employee leave balances must be self-only", "employeeId");
    expectStatus(await request("/api/leave/balances?organizationId=" +
      victim.id + "&asOf=2026-10-19", { cookie: employeeCookie }), 403,
      "Employee " + idx + " must not switch to victim leave balances");

    for (const [path, label] of [
      ["/api/payroll-runs?organizationId=" + attacker.id, "payroll run listing"],
      ["/api/payroll-runs?runId=" + f.ownRuns[idx].id + "&include=entries", "payroll register"],
      ["/api/approval-chains?organizationId=" + attacker.id, "approval administration"],
      ["/api/legal-entities?organizationId=" + attacker.id + "&mode=selector", "legal employer administration"],
      ["/api/assets?organizationId=" + attacker.id, "company asset administration"],
    ]) {
      expectStatus(await request(path, { cookie: employeeCookie }), 403,
        "Employee " + idx + " must not access privileged " + label);
    }

    // Former-employer membership revocation is exercised by the already-merged
    // verifyRevokedEmployerPayslipAccess fixture and its independent two-attacker controls.

    console.log("PASS additional three-org attacker-" + idx +
      ": owned attachment, foreign IDs, legal employer, leave mutation, ESS pay and employee role");
  }

  const victimDocumentsAfter = await db.select().from(documents)
    .where(eq(documents.organizationId, victim.id)).orderBy(documents.id);
  const victimLeavePoliciesAfter = await db.select().from(leavePolicies)
    .where(eq(leavePolicies.organizationId, victim.id)).orderBy(leavePolicies.id);
  const victimLegalEntitiesAfter = await db.select().from(legalEntities)
    .where(eq(legalEntities.organizationId, victim.id)).orderBy(legalEntities.id);
  assert.deepEqual(victimDocumentsAfter, victimDocumentsBefore,
    "Victim documents and bytes must remain unchanged after foreign direct download attempts");
  assert.deepEqual(victimLeavePoliciesAfter, victimLeavePoliciesBefore,
    "Victim leave policies must remain unchanged after forged cross-tenant POST");
  assert.deepEqual(victimLegalEntitiesAfter, victimLegalEntitiesBefore,
    "Victim legal employers must remain unchanged after unauthorized selector calls");
  assertions += 15;
}

/**
 * Regression: the same employee-role session must lose access to a real
 * previously downloadable payslip when its former employer membership is
 * revoked, even if the account remains active at another fictional employer.
 * This runs in the existing 3-employer disposable PG16/localhost harness.
 */
async function verifyRevokedEmployerPayslipAccess(f) {
  const [victimEntry] = await db.select({ id: payrollEntries.id }).from(payrollEntries)
    .where(and(eq(payrollEntries.payrollRunId, f.victimRun.id),
      eq(payrollEntries.employeeId, f.victimEmployee.id))).limit(1);
  assert.ok(victimEntry?.id > 6, "Victim-only PDF ID must be real and greater than six");

  for (const idx of [1, 2]) {
    const formerOrg = f.orgs[idx];
    const newOrg = f.orgs[idx === 1 ? 2 : 1];
    const ownEmployee = f.ownedEmployees[idx - 1];
    const [ownEntry] = await db.select().from(payrollEntries)
      .where(and(eq(payrollEntries.payrollRunId, f.ownRuns[idx].id),
        eq(payrollEntries.employeeId, ownEmployee.id))).limit(1);
    assert.ok(ownEntry?.id > 6, "Stale membership probe requires a real owned Released pay entry");

    const [essUser] = await db.insert(users).values({
      email: "fictional-transferred-ess-" + idx + "-" + f.owners[idx].id + "@example.invalid",
      name: "Fictional transferred employee " + idx,
      passwordHash: "fictional-cookie-auth-only", role: "employee",
      employeeId: ownEmployee.id,
    }).returning({ id: users.id });
    await db.insert(userOrganizations).values({
      userId: essUser.id, organizationId: formerOrg.id, role: "employee", active: true,
    });
    const employeeCookie = (await makeSession(essUser.id)).cookie;

    const ownedPdf = expectStatus(await request("/api/self/payslips/" + ownEntry.id, {
      cookie: employeeCookie,
    }), 200, "Employee " + idx + " own Released payslip must work BEFORE membership revocation");
    assert.match(ownedPdf.headers.get("content-type") ?? "", /^application\/pdf/);
    assert.ok(ownedPdf.text.startsWith("%PDF-"),
      "Own positive must return actual PDF bytes, not empty/invalid success");
    expectStatus(await request("/api/self/payslips/" + victimEntry.id, {
      cookie: employeeCookie,
    }), 404, "Employee " + idx + " must not retrieve real high-ID victim-employer PDF");

    // Change *real* memberships without changing the session or the
    // employeeId link. This is a former-employer data-access regression.
    await db.insert(userOrganizations).values({
      userId: essUser.id, organizationId: newOrg.id, role: "employee", active: true,
    });
    await db.update(userOrganizations).set({ active: false })
      .where(and(eq(userOrganizations.userId, essUser.id),
        eq(userOrganizations.organizationId, formerOrg.id)));
    const [revoked] = await db.select().from(userOrganizations)
      .where(and(eq(userOrganizations.userId, essUser.id),
        eq(userOrganizations.organizationId, formerOrg.id)));
    const [stillMember] = await db.select().from(userOrganizations)
      .where(and(eq(userOrganizations.userId, essUser.id),
        eq(userOrganizations.organizationId, newOrg.id)));
    assert.equal(revoked?.active, false, "Actual former-employer grant must be inactive");
    assert.equal(stillMember?.active, true, "New employer membership must remain active");

    const stillSignedIn = expectStatus(await request("/api/account", {
      cookie: employeeCookie,
    }), 200, "Same employee session must still be authenticated after moving employer");
    assert.equal(stillSignedIn.json?.profile?.id, essUser.id,
      "An invalid or different session must never count as a denial");
    const beforeDeniedPdf = (await db.select().from(payrollEntries)
      .where(eq(payrollEntries.id, ownEntry.id)))[0];
    assert.deepEqual(beforeDeniedPdf, ownEntry, "Owned payroll row must exist before access denial");
    const revokedPdf = expectStatus(await request("/api/self/payslips/" + ownEntry.id, {
      cookie: employeeCookie,
    }), 403, "Former-employer payslip PDF must deny a signed-in employee after revocation");
    assert.ok(!revokedPdf.text.startsWith("%PDF-"), "Denied PDF must not return former-employer bytes");
    const afterDeniedPdf = (await db.select().from(payrollEntries)
      .where(eq(payrollEntries.id, ownEntry.id)))[0];
    assert.deepEqual(afterDeniedPdf, beforeDeniedPdf, "Denied PDF may not modify the old payroll row");
    console.log("PASS employee-" + idx + ": own PDF 200, victim 404, still-signed-in 200, former-employer PDF 403");
  }
}

async function verifyNewMainRouteIsolation(f) {
  const victim = f.orgs[0];
  const [victimCase] = await db.insert(employeeHrCases).values({
    organizationId: victim.id, employeeId: f.victimEmployee.id,
    createdByUserId: f.owners[0].id, caseType: "general", assignedRole: "hr",
    subject: "Fictional victim request", description: "Confidential fictional victim details",
    slaDueAt: new Date(Date.now() + 86_400_000),
  }).returning();
  const victimCasesBefore = await db.select().from(employeeHrCases).where(eq(employeeHrCases.organizationId, victim.id));
  const victimMessagesBefore = await db.select().from(employeeHrCaseMessages).where(eq(employeeHrCaseMessages.organizationId, victim.id));
  const victimBatchesBefore = await db.select().from(birWithholdingRemittanceBatches).where(eq(birWithholdingRemittanceBatches.organizationId, victim.id));
  const victimPayrollBefore = await db.select().from(payrollRuns).where(eq(payrollRuns.id, f.victimRun.id));
  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    const ownAssurance = expectStatus(await request("/api/payroll-runs/" + f.ownRuns[idx].id + "/assurance", { cookie }), 200, "Own assurance is readable");
    assert.equal(ownAssurance.json?.organizationId, org.id);
    expectStatus(await request("/api/payroll-runs/" + f.victimRun.id + "/assurance", { cookie }), 403, "Real victim assurance denied");
    const ownChecklist = expectStatus(await request("/api/payroll-runs/" + f.ownRuns[idx].id + "/release-checklist", { cookie }), 200, "Own release checklist is readable");
    assert.equal(ownChecklist.json?.runId, f.ownRuns[idx].id);
    expectStatus(await request("/api/payroll-runs/" + f.victimRun.id + "/release-checklist", { cookie }), 403, "Real victim checklist denied");

    const [ess] = await db.insert(users).values({ email: "case-qa-" + randomUUID() + "@example.invalid", name: "Fictional case employee", passwordHash: "fixture-no-login", role: "employee", employeeId: f.ownedEmployees[idx - 1].id }).returning();
    await db.insert(userOrganizations).values({ userId: ess.id, organizationId: org.id, role: "employee", active: true });
    const essCookie = (await makeSession(ess.id)).cookie;
    // A forged employer/worker in POST must be ignored in favor of the session's worker.
    const ownCaseCreate = expectStatus(await request("/api/hr-cases", { method: "POST", cookie: essCookie, body: { organizationId: victim.id, employeeId: f.victimEmployee.id, caseType: "general", subject: "Fictional owned request", description: "Fictional own employee service request" } }), 201, "Employee creates own case despite forged employer");
    const caseId = ownCaseCreate.json?.case?.id;
    assert.equal(ownCaseCreate.json?.case?.organizationId, org.id);
    const [persistedCase] = await db.select().from(employeeHrCases).where(eq(employeeHrCases.id, caseId));
    assert.equal(persistedCase.employeeId, ess.employeeId);
    const ownCases = expectStatus(await request("/api/hr-cases?organizationId=" + org.id, { cookie }), 200, "Owner reads actual owned case");
    ownOnly(ownCases.json?.cases, caseId, [victimCase.id], "Cases exclude victim");
    expectStatus(await request("/api/hr-cases?organizationId=" + victim.id, { cookie }), 403, "Owner cannot read victim inbox");
    const ownCasePatch = expectStatus(await request("/api/hr-cases", { method: "PATCH", cookie, body: { id: caseId, action: "status", status: "in_progress" } }), 200, "Owner changes own case");
    assert.equal(ownCasePatch.json?.case?.status, "in_progress");
    expectStatus(await request("/api/hr-cases", { method: "PATCH", cookie, body: { id: victimCase.id, action: "status", status: "in_progress" } }), 404, "Victim case is indistinguishable from absent");
    expectStatus(await request("/api/hr-cases", { method: "PATCH", cookie: essCookie, body: { id: victimCase.id, action: "reply", message: "Forged reply" } }), 404, "Employee cannot reply to victim case");

    // Only fictional fixture users/sessions receive a verified MFA timestamp.
    await db.update(users).set({ totpEnabled: true }).where(eq(users.id, f.owners[idx].id));
    await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, f.ownerSessions[idx].id));
    const [pastRun] = await db.insert(payrollRuns).values({ organizationId: org.id, legalEntityId: f.entities[idx].id, periodLabel: "Fictional prior month", periodStart: "2025-09-01", periodEnd: "2025-09-15", payDate: "2025-09-16", status: "Released" }).returning();
    await db.insert(payrollEntries).values({ payrollRunId: pastRun.id, employeeId: ess.employeeId, grossPay: "5000.00", deductions: "0.00", netPay: "5000.00" });
    const ownBirCreate = expectStatus(await request("/api/compliance/bir-1601c-remittances", { method: "POST", cookie, body: { organizationId: org.id, legalEntityId: f.entities[idx].id, action: "create_batch", applicableMonth: "2025-09", filingChannel: "non_efps" } }), 201, "Own BIR batch creation succeeds with fixture MFA");
    assert.ok(ownBirCreate.json);
    expectStatus(await request("/api/compliance/bir-1601c-remittances", { method: "POST", cookie, body: { organizationId: victim.id, legalEntityId: f.entities[0].id, action: "create_batch", applicableMonth: "2025-09", filingChannel: "non_efps" } }), 403, "Foreign BIR batch creation denied");
    const ownBirRead = expectStatus(await request("/api/compliance/bir-1601c-remittances?organizationId=" + org.id + "&legalEntityId=" + f.entities[idx].id, { cookie }), 200, "Own stored BIR batch readable");
    assert.ok(ownBirRead.json?.batches?.some(row => row.organizationId === org.id && row.applicableMonth === "2025-09"));
    expectStatus(await request("/api/compliance/bir-1601c-remittances?organizationId=" + victim.id + "&legalEntityId=" + f.entities[0].id, { cookie }), 403, "Foreign BIR read denied");
  }
  const victimCasesAfter = await db.select().from(employeeHrCases).where(eq(employeeHrCases.organizationId, victim.id));
  assert.deepEqual(victimCasesAfter, victimCasesBefore, "Denied and forged case writes leave victim cases unchanged");
  const victimMessagesAfter = await db.select().from(employeeHrCaseMessages).where(eq(employeeHrCaseMessages.organizationId, victim.id));
  assert.deepEqual(victimMessagesAfter, victimMessagesBefore, "Denied case replies leave victim messages unchanged");
  const victimBatchesAfter = await db.select().from(birWithholdingRemittanceBatches).where(eq(birWithholdingRemittanceBatches.organizationId, victim.id));
  assert.deepEqual(victimBatchesAfter, victimBatchesBefore, "Denied BIR writes leave victim batches unchanged");
  const victimPayrollAfter = await db.select().from(payrollRuns).where(eq(payrollRuns.id, f.victimRun.id));
  assert.deepEqual(victimPayrollAfter, victimPayrollBefore, "Denied financial reads leave victim payroll unchanged");
}

async function main() {
  requireDisposable();
  const f = await makeFixture();
  const victim = f.orgs[0];
  const beforeWebhookProbe = (await db.select().from(providerEvents)
    .where(eq(providerEvents.organizationId, f.orgs[0].id))).map((e) => e.id).sort((a,b) => a-b);
  await baselineProbeAllMethods(f);
  const afterWebhookProbe = (await db.select().from(providerEvents)
    .where(eq(providerEvents.organizationId, f.orgs[0].id))).map((e) => e.id).sort((a,b) => a-b);
  assert.deepEqual(afterWebhookProbe, beforeWebhookProbe,
    "Forged provider webhook probes must not insert victim provider events");
  await verifyCrossTenant(f);
  await verifyRevokedEmployerPayslipAccess(f);
  await verifySensitiveTenantDownloadsAndRoles(f);
  await verifyNewMainRouteIsolation(f);
  // Method-level manifest tests stay at the tail to preserve source-pinned
  // evidence offsets for the earlier 43 already-provisionally-COVERED methods.
  await (await import("./tenant-manifest-driven-http.mjs")).verifyManifestDrivenStatutoryBatch(f, { request, expectStatus });
  await (await import("./tenant-scoped-page-probes.mjs")).probeManifestBusinessPages(f, { request, makeSession, expectStatus });
  // Every record is fictional and written only to the isolated CI database.
  console.log(JSON.stringify({
    result: "PASS", kind: "SYNTHETIC_REAL_HTTP_ONLY", families: SECOND_PASS_FAMILIES,
    inventoriedRoutes: Object.keys(SECOND_PASS_ROUTES).length,
    probedHttpMethods: Object.values(SECOND_PASS_ROUTES).reduce((n,s) => n+s.split(" ").length, 0),
    attackerOrganizations: 2, victimOnlyIdsAboveSix: [
      f.victimEmployee.id, f.victimIdentity.id, f.victimSlip.id, f.victimRun.id,
      f.victimUnit.id, f.victimSessions.at(-1).id,
    ],
    victimOrganizationId: victim.id, assertions,
    humanUatAccepted: false, externalProviderAccepted: false, productionApproved: false,
  }));
}

main().catch((error) => {
  console.error("Second-pass tenant isolation FAILED (not accepted):", error);
  process.exitCode = 1;
});

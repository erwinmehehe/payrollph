import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { db, pool } from "../src/db";
import {
  legalEntities,
  organizations,
  orgUnits,
  permissionSets,
  sessions,
  userOrganizations,
  userPermissionAssignments,
  users,
  workforcePlanAllocations,
  workforcePlans,
} from "../src/db/schema";

/**
 * Real HTTP acceptance using legitimate, database-backed sessions and TWO
 * fictional employers. Runs ONLY against disposable local PG in Security HTTP
 * Smoke CI; never against live Neon, Vercel or an employer's actual records.
 */
const ROUTES = [
  "/api/bi-exports",
  "/api/workforce-planning",
  "/api/workforce-planning/allocations",
] as const;

type Route = (typeof ROUTES)[number];
type JsonRecord = Record<string, unknown>;

function requireIsolatedCi(baseUrl: string) {
  let database: URL;
  let app: URL;
  try {
    database = new URL(process.env.DATABASE_URL ?? "");
    app = new URL(baseUrl);
  } catch {
    throw new Error("Workforce/BI HTTP acceptance requires explicit disposable local URLs.");
  }

  if (
    process.env.CI !== "true"
    || process.env.WORKFORCE_BI_HTTP_ACCEPTANCE_MODE !== "isolated-ci-only"
    || database.protocol !== "postgresql:"
    || !["127.0.0.1", "localhost"].includes(database.hostname)
    || database.port !== "5432"
    || database.pathname !== "/app_db"
    || app.protocol !== "http:"
    || app.hostname !== "127.0.0.1"
    || app.port !== "3000"
    || process.env.MULTI_ENTITY_ENABLED === "true"
    || process.env.PAYMONGO_DISBURSEMENTS_ENABLED === "true"
    || process.env.XENDIT_PAYOUTS_ENABLED === "true"
  ) {
    throw new Error("Refusing Workforce/BI acceptance without isolated CI PostgreSQL and local app.");
  }
}

function list(value: unknown, field: string): JsonRecord[] {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Expected JSON object");
  const rows = (value as JsonRecord)[field];
  assert.ok(Array.isArray(rows), "Expected array at " + field);
  return rows as JsonRecord[];
}

function ids(rows: JsonRecord[]): number[] {
  return rows.map((row) => Number(row.id)).sort((a, b) => a - b);
}

function assertContainsOwnOnly(body: JsonRecord, field: string, own: number[], foreign: number[]) {
  const actual = ids(list(body, field));
  assert.deepEqual(actual, [...own].sort((a, b) => a - b), field + ": must show only this employer's seeded rows");
  for (const id of foreign) {
    assert.ok(!actual.includes(id), field + ": foreign row disclosed");
  }
}

async function makeLocalSession(userId: number) {
  // This is deliberately NOT a login bypass in the application: the production
  // auth path still validates the session cookie/hash and membership on EVERY GET.
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    lastSeenAt: new Date(),
  });
  return "__Host-linaw_session=" + token;
}

async function getJson(
  baseUrl: string,
  route: Route,
  organizationId: number,
  cookie: string | null,
  expectedStatus: 200 | 401 | 403,
  scenario: string,
): Promise<JsonRecord> {
  const requestUrl = new URL(route + "?organizationId=" + organizationId, baseUrl);
  const response = await fetch(requestUrl, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    headers: cookie ? { Cookie: cookie } : {},
  });
  assert.equal(response.status, expectedStatus, scenario + " " + route + ": wrong HTTP status");
  assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
  const body: unknown = await response.json();
  assert.ok(body && typeof body === "object" && !Array.isArray(body), "Expected JSON body");
  const payload = body as JsonRecord;
  if (expectedStatus !== 200) {
    assert.equal(typeof payload.error, "string", scenario + ": denial must be explicit");
    for (const forbidden of ["datasets", "scopes", "profiles", "plans", "positions", "allocations", "submissions"]) {
      assert.ok(!(forbidden in payload), scenario + ": denial exposed " + forbidden);
    }
  }
  console.log("PASS isolated Workforce/BI HTTP: " + scenario + " " + route + " status=" + expectedStatus);
  return payload;
}

export async function runWorkforceBiHttpAcceptance(input: {
  baseUrl: string;
  organizationId: number;
  ownerUserId: number;
  ownerCookie: string;
}) {
  try {
    requireIsolatedCi(input.baseUrl);
    assert.ok(Number.isSafeInteger(input.organizationId) && input.organizationId > 0);
    assert.ok(Number.isSafeInteger(input.ownerUserId) && input.ownerUserId > 0);
    assert.match(input.ownerCookie, /^__Host-linaw_session=[a-f0-9]{64}$/);

    // Synthetic fixtures deliberately have different, nonempty rows so a
    // falsely successful empty response will NOT satisfy the tenant tests.
    const [beta] = await db.insert(organizations).values({
      name: "QA Synthetic Employer Beta",
      legalName: "QA Synthetic Employer Beta Inc.",
      accountType: "business",
      plan: "Core",
      employeeCount: 0,
      color: "#176B5D",
    }).returning({ id: organizations.id });
    assert.ok(beta);

    const [ownerBeta] = await db.insert(users).values({
      name: "QA Fictional Beta Owner",
      email: "qa-bi-owner-beta@example.invalid",
      passwordHash: "ci-fixture-no-password-login",
      role: "owner",
    }).returning({ id: users.id });
    const [employeeAlpha] = await db.insert(users).values({
      name: "QA Fictional Alpha Employee",
      email: "qa-bi-employee-alpha@example.invalid",
      passwordHash: "ci-fixture-no-password-login",
      role: "employee",
    }).returning({ id: users.id });
    const [managerAlpha] = await db.insert(users).values({
      name: "QA Fictional Alpha Manager",
      email: "qa-bi-manager-alpha@example.invalid",
      passwordHash: "ci-fixture-no-password-login",
      role: "manager",
    }).returning({ id: users.id });
    const [restrictedAlpha] = await db.insert(users).values({
      name: "QA Fictional Alpha Restricted Owner",
      email: "qa-bi-restricted-alpha@example.invalid",
      passwordHash: "ci-fixture-no-password-login",
      role: "owner",
    }).returning({ id: users.id });
    assert.ok(ownerBeta && employeeAlpha && managerAlpha && restrictedAlpha);

    const [alphaEntity] = await db.insert(legalEntities).values({
      organizationId: input.organizationId,
      code: "QA-ALPHA-ENTITY",
      legalName: "QA Synthetic Alpha Entity Inc.",
      displayName: "QA Alpha Entity",
    }).returning({ id: legalEntities.id });
    const [betaEntity] = await db.insert(legalEntities).values({
      organizationId: beta.id,
      code: "QA-BETA-ENTITY",
      legalName: "QA Synthetic Beta Entity Inc.",
      displayName: "QA Beta Entity",
    }).returning({ id: legalEntities.id });
    assert.ok(alphaEntity && betaEntity);

    const [alphaUnit] = await db.insert(orgUnits).values({
      organizationId: input.organizationId,
      code: "QA-ALPHA-UNIT",
      name: "QA Alpha Unit",
      type: "department",
      legalEntityId: alphaEntity.id,
    }).returning({ id: orgUnits.id });
    const [alphaOtherUnit] = await db.insert(orgUnits).values({
      organizationId: input.organizationId,
      code: "QA-ALPHA-OTHER",
      name: "QA Alpha Other Unit",
      type: "department",
      legalEntityId: alphaEntity.id,
    }).returning({ id: orgUnits.id });
    const [betaUnit] = await db.insert(orgUnits).values({
      organizationId: beta.id,
      code: "QA-BETA-UNIT",
      name: "QA Beta Unit",
      type: "department",
      legalEntityId: betaEntity.id,
    }).returning({ id: orgUnits.id });
    assert.ok(alphaUnit && alphaOtherUnit && betaUnit);

    await db.insert(userOrganizations).values([
      { userId: ownerBeta.id, organizationId: beta.id, role: "owner" },
      { userId: employeeAlpha.id, organizationId: input.organizationId, role: "employee" },
      { userId: managerAlpha.id, organizationId: input.organizationId, role: "manager", orgUnitId: alphaUnit.id },
    ]);
    const [restrictedMembership] = await db.insert(userOrganizations).values({
      userId: restrictedAlpha.id,
      organizationId: input.organizationId,
      role: "owner",
    }).returning({ id: userOrganizations.id });
    assert.ok(restrictedMembership);
    const [denyOnlySet] = await db.insert(permissionSets).values({
      organizationId: input.organizationId,
      name: "QA deny all Workforce BI gates",
      permissions: [],
      active: true,
    }).returning({ id: permissionSets.id });
    assert.ok(denyOnlySet);
    await db.insert(userPermissionAssignments).values({
      organizationId: input.organizationId,
      userOrganizationId: restrictedMembership.id,
      permissionSetId: denyOnlySet.id,
    });

    const [alphaPlan] = await db.insert(workforcePlans).values({
      organizationId: input.organizationId,
      name: "QA Alpha Plan",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      budget: "100.00",
    }).returning({ id: workforcePlans.id });
    const [betaPlan] = await db.insert(workforcePlans).values({
      organizationId: beta.id,
      name: "QA Beta Plan",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      budget: "200.00",
    }).returning({ id: workforcePlans.id });
    assert.ok(alphaPlan && betaPlan);
    const [alphaAllocation] = await db.insert(workforcePlanAllocations).values({
      organizationId: input.organizationId,
      planId: alphaPlan.id,
      orgUnitId: alphaUnit.id,
      headcountCeiling: 2,
      annualBudgetCeiling: "100.00",
    }).returning({ id: workforcePlanAllocations.id });
    const [alphaOtherAllocation] = await db.insert(workforcePlanAllocations).values({
      organizationId: input.organizationId,
      planId: alphaPlan.id,
      orgUnitId: alphaOtherUnit.id,
      headcountCeiling: 1,
      annualBudgetCeiling: "50.00",
    }).returning({ id: workforcePlanAllocations.id });
    const [betaAllocation] = await db.insert(workforcePlanAllocations).values({
      organizationId: beta.id,
      planId: betaPlan.id,
      orgUnitId: betaUnit.id,
      headcountCeiling: 3,
      annualBudgetCeiling: "200.00",
    }).returning({ id: workforcePlanAllocations.id });
    assert.ok(alphaAllocation && alphaOtherAllocation && betaAllocation);

    const cookies = {
      alpha: input.ownerCookie,
      beta: await makeLocalSession(ownerBeta.id),
      employee: await makeLocalSession(employeeAlpha.id),
      manager: await makeLocalSession(managerAlpha.id),
      restricted: await makeLocalSession(restrictedAlpha.id),
    };

    for (const route of ROUTES) {
      // Three tested boundaries: no authentication, wrong role, wrong employer.
      await getJson(input.baseUrl, route, input.organizationId, null, 401, "anonymous");
      await getJson(input.baseUrl, route, input.organizationId, cookies.employee, 403, "employee denied");
      await getJson(input.baseUrl, route, input.organizationId, cookies.restricted, 403, "deny-only permission");
      await getJson(input.baseUrl, route, beta.id, cookies.alpha, 403, "alpha owner cannot read beta");
      await getJson(input.baseUrl, route, input.organizationId, cookies.beta, 403, "beta owner cannot read alpha");

      const alpha = await getJson(input.baseUrl, route, input.organizationId, cookies.alpha, 200, "alpha owner");
      const betaPayload = await getJson(input.baseUrl, route, beta.id, cookies.beta, 200, "beta owner");

      if (route === "/api/bi-exports") {
        assert.ok(list(alpha, "datasets").length > 0, "Alpha BI definitions must not be empty");
        assert.ok(list(betaPayload, "datasets").length > 0, "Beta BI definitions must not be empty");
        const alphaScopes = alpha.scopes as JsonRecord;
        const betaScopes = betaPayload.scopes as JsonRecord;
        assert.ok(alphaScopes && betaScopes);
        assertContainsOwnOnly(alphaScopes, "legalEntities", [alphaEntity.id], [betaEntity.id]);
        assertContainsOwnOnly(betaScopes, "legalEntities", [betaEntity.id], [alphaEntity.id]);
        assertContainsOwnOnly(alphaScopes, "orgUnits", [alphaUnit.id, alphaOtherUnit.id], [betaUnit.id]);
        assertContainsOwnOnly(betaScopes, "orgUnits", [betaUnit.id], [alphaUnit.id, alphaOtherUnit.id]);
      } else if (route === "/api/workforce-planning") {
        assertContainsOwnOnly(alpha, "plans", [alphaPlan.id], [betaPlan.id]);
        assertContainsOwnOnly(betaPayload, "plans", [betaPlan.id], [alphaPlan.id]);
        assertContainsOwnOnly(alpha, "orgUnits", [alphaUnit.id, alphaOtherUnit.id], [betaUnit.id]);
        assertContainsOwnOnly(betaPayload, "orgUnits", [betaUnit.id], [alphaUnit.id, alphaOtherUnit.id]);
      } else {
        assertContainsOwnOnly(alpha, "allocations", [alphaAllocation.id, alphaOtherAllocation.id], [betaAllocation.id]);
        assertContainsOwnOnly(betaPayload, "allocations", [betaAllocation.id], [alphaAllocation.id, alphaOtherAllocation.id]);
      }

      // Manager is valid only for assigned unit, never for BI exports.
      const managerStatus = route === "/api/bi-exports" ? 403 : 200;
      const manager = await getJson(input.baseUrl, route, input.organizationId, cookies.manager, managerStatus, "scoped manager");
      if (route === "/api/workforce-planning") {
        assertContainsOwnOnly(manager, "orgUnits", [alphaUnit.id], [alphaOtherUnit.id, betaUnit.id]);
        assert.equal((manager.access as JsonRecord).companyWide, false);
      }
      if (route === "/api/workforce-planning/allocations") {
        assertContainsOwnOnly(manager, "allocations", [alphaAllocation.id], [alphaOtherAllocation.id, betaAllocation.id]);
        assert.equal((manager.access as JsonRecord).companyWide, false);
      }
    }

    console.log("PASS isolated Workforce/BI authenticated HTTP acceptance: 24/24 role and tenant probes; fictional only.");
  } finally {
    // This pool belongs to this CLI runner, never to the separate Next server.
    await pool.end();
  }
}

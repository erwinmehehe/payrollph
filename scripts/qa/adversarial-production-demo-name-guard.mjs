import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { employees, organizations, payrollRuns, sessions, userOrganizations, users } from "../../src/db/schema";
import { POST } from "../../src/app/api/auth/demo-switch/route";

// Only CI's disposable PostgreSQL 16 service may run this test. It NEVER
// sends traffic to a public site or changes production records or credentials.
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.ISOLATED_SIX_ROLE_RBAC, "disposable-pg16-only");
assert.equal(process.env.DEMO_MODE, "true");
assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
assert.equal(dbUrl.hostname, "127.0.0.1");
assert.equal(dbUrl.port, "5432");
assert.equal(dbUrl.pathname, "/app_db");

const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
let orgIds = [];
let userId = null;
const envRestore = Object.fromEntries([
  "NODE_ENV", "PUBLIC_DEMO_HOSTS", "PUBLIC_DEMO_DATABASE_ATTESTED",
  "PUBLIC_DEMO_NEON_PROJECT_ID", "PUBLIC_DEMO_NEON_BRANCH_ID",
  "PUBLIC_DEMO_NEON_ENDPOINT_ID", "PUBLIC_DEMO_DATABASE_NAME",
  "PUBLIC_DEMO_DATABASE_ROLE", "PUBLIC_DEMO_DATABASE_HOST",
  "PUBLIC_DEMO_ORGANIZATION_ID",
].map(key => [key, process.env[key]]));

async function records() {
  return {
    organizations: await db.select().from(organizations).where(inArray(organizations.id, orgIds)).orderBy(organizations.id),
    employees: await db.select().from(employees).where(inArray(employees.organizationId, orgIds)).orderBy(employees.id),
    payroll: await db.select().from(payrollRuns).where(inArray(payrollRuns.organizationId, orgIds)).orderBy(payrollRuns.id),
    user: userId ? await db.select().from(users).where(eq(users.id, userId)) : [],
    memberships: userId ? await db.select().from(userOrganizations).where(eq(userOrganizations.userId, userId)) : [],
    sessions: userId ? await db.select().from(sessions).where(eq(sessions.userId, userId)) : [],
  };
}

async function deniedWithNoCustomerWrites(label) {
  const before = await records();
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let response;
  try {
    response = await POST(new Request("http://127.0.0.1:3000/api/auth/demo-switch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://127.0.0.1:3000",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ role: "owner" }),
    }));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  assert.equal(response.status, 404, label + ": must be blocked, not create demo roles");
  assert.equal(response.headers.get("set-cookie"), null, label + ": must not issue a session cookie");
  assert.ok(isDeepStrictEqual(await records(), before),
    label + ": customer organization, employee, payroll, user, memberships and sessions MUST NOT change");
  console.log("ADVERSARIAL_DEMO_NAME_GUARD " + label + " denied=404 customerRowsUnchanged=true sessionCookieIssued=false");
}

try {
  process.env.PUBLIC_DEMO_HOSTS = "127.0.0.1";
  delete process.env.PUBLIC_DEMO_DATABASE_ATTESTED;

  // This is a CUSTOMER despite having exactly the ordinary editable fictional
  // company's names. Include a real employee, payroll run, user and membership.
  const [customer] = await db.insert(organizations).values({
    name: "Loom & Local", legalName: "Loom & Local Philippines Inc.",
  }).returning({ id: organizations.id });
  orgIds.push(customer.id);
  await db.insert(employees).values({
    organizationId: customer.id, employeeNo: "CUST-" + nonce,
    firstName: "Customer", lastName: "Employee", title: "Payroll Manager",
    avatarInitials: "CE", basicRate: "68000.00",
    bankAccount: null, tin: null, startDate: "2025-01-01",
  });
  await db.insert(payrollRuns).values({
    organizationId: customer.id, periodLabel: "CUSTOMER_EXISTING_RUN_" + nonce,
    periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-16",
    status: "Draft", grossPay: "68000.00", netPay: "55000.00",
  });
  const [customerUser] = await db.insert(users).values({
    email: "owner.demo@linaw.ph", name: "Customer Account — Do Not Reassign",
    passwordHash: "qa-no-login", localPasswordEnabled: false, role: "owner",
  }).returning({ id: users.id });
  userId = customerUser.id;
  await db.insert(userOrganizations).values({
    userId, organizationId: customer.id, role: "owner",
  });
  await deniedWithNoCustomerWrites("one-customer-same-name-and-legal-name");

  // Even a misconfigured attestation attempt must never turn disposable PG
  // or the customer's records into an approved live Neon fixture database.
  process.env.PUBLIC_DEMO_DATABASE_ATTESTED = "true";
  process.env.PUBLIC_DEMO_NEON_PROJECT_ID = "fixture-only-project-qa";
  process.env.PUBLIC_DEMO_NEON_BRANCH_ID = "br-fixture-qa-001";
  process.env.PUBLIC_DEMO_NEON_ENDPOINT_ID = "ep-fixture-only-qa";
  process.env.PUBLIC_DEMO_DATABASE_NAME = "fictional_demo";
  process.env.PUBLIC_DEMO_DATABASE_ROLE = "fixture_role";
  process.env.PUBLIC_DEMO_DATABASE_HOST = "ep-fixture-only-qa.eu-central-1.aws.neon.tech";
  process.env.PUBLIC_DEMO_ORGANIZATION_ID = String(customer.id);
  await deniedWithNoCustomerWrites("spoofed-config-customer-same-name");

  const [second] = await db.insert(organizations).values({
    name: "Loom & Local", legalName: "Loom & Local Philippines Inc.",
  }).returning({ id: organizations.id });
  orgIds.push(second.id);
  await deniedWithNoCustomerWrites("two-same-name-employers");
  console.log("ADVERSARIAL_DEMO_NAME_GUARD all_scenarios_passed=3 database=disposable-pg16-only");
} finally {
  for (const [key, value] of Object.entries(envRestore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    if (userId !== null) {
      await db.delete(userOrganizations).where(eq(userOrganizations.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    if (orgIds.length) {
      await db.delete(payrollRuns).where(inArray(payrollRuns.organizationId, orgIds));
      await db.delete(employees).where(inArray(employees.organizationId, orgIds));
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
  } finally {
    await pool.end();
  }
}

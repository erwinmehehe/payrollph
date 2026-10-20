import { sql } from "drizzle-orm";
import { db } from "@/db";
import { normalizeRuntimeDatabaseIdentity, type RuntimeDatabaseIdentity } from "@/lib/runtime-database-identity";
import { PUBLIC_DEMO_DATABASE_IDENTITY_SQL, verifiedPublicDemoDatabaseIdentity } from "@/lib/public-demo-database-identity";

// A DEMO deployment must have its own independently provisioned Neon PROJECT,
// role, database and fixture-org ID. These are operator-attested server secrets,
// never populated from organizations.name/legalName or from the request.
// The actual customer-serving project is always forbidden, even on a new branch.
const CUSTOMER_PRODUCTION_PROJECT_ID = "calm-wave-70219564";
const CUSTOMER_PRODUCTION_BRANCH_ID = "br-lucky-sound-b79i56jw";
const FIXTURE_NAME = "Loom & Local";
const FIXTURE_LEGAL_NAME = "Loom & Local Philippines Inc.";

export type DemoProvisioningBoundary =
  | "demo_only"
  | "blocked_non_demo_employer"
  | "unverified"
  | "non_production";

type FixtureOrganization = { id: number; name: string; legalName: string };
type FixtureReader = Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], "execute">;

function fixtureSettings(env: NodeJS.ProcessEnv) {
  const projectId = env.PUBLIC_DEMO_NEON_PROJECT_ID?.trim() ?? "";
  const branchId = env.PUBLIC_DEMO_NEON_BRANCH_ID?.trim() ?? "";
  const endpointId = env.PUBLIC_DEMO_NEON_ENDPOINT_ID?.trim() ?? "";
  const databaseName = env.PUBLIC_DEMO_DATABASE_NAME?.trim() ?? "";
  const roleName = env.PUBLIC_DEMO_DATABASE_ROLE?.trim() ?? "";
  const hostname = env.PUBLIC_DEMO_DATABASE_HOST?.trim().toLowerCase() ?? "";
  const organizationText = env.PUBLIC_DEMO_ORGANIZATION_ID?.trim() ?? "";
  if (
    !/^[a-z0-9-]{5,60}$/.test(projectId) ||
    !/^br-[a-z0-9-]{4,58}$/.test(branchId) ||
    !/^ep-[a-z0-9-]{4,58}$/.test(endpointId) ||
    !/^[A-Za-z0-9_]{1,63}$/.test(databaseName) ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(roleName) ||
    !/^[1-9][0-9]{0,14}$/.test(organizationText) ||
    projectId === CUSTOMER_PRODUCTION_PROJECT_ID ||
    branchId === CUSTOMER_PRODUCTION_BRANCH_ID
  ) return null;
  // A dedicated TLS-verified Neon endpoint, not localhost, an arbitrary URL
  // or the customer PostgreSQL instance, must be the actual connection target.
  if (!hostname.startsWith(endpointId + ".") &&
      !hostname.startsWith(endpointId + "-pooler.")) return null;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/.test(hostname)) return null;

  let connectedHostname: string;
  try {
    const parsed = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) return null;
    connectedHostname = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (hostname !== connectedHostname) return null;
  const organizationId = Number(organizationText);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return null;
  return { projectId, branchId, endpointId, databaseName, roleName, hostname, organizationId };
}

/**
 * Pure positive attestation. Editable company name/legalName are consistency
 * checks only: never evidence that a customer record is a fictional fixture.
 * Exactly ONE pre-registered organization must exist; no public request is
 * permitted to bootstrap an unattested production organization.
 */
export function isAttestedProductionDemoFixture(
  identity: RuntimeDatabaseIdentity,
  organizations: FixtureOrganization[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = fixtureSettings(env);
  if (!expected || identity.inRecovery) return false;
  if (
    identity.projectId !== expected.projectId ||
    identity.branchId !== expected.branchId ||
    identity.endpointId !== expected.endpointId ||
    identity.databaseName !== expected.databaseName ||
    identity.roleName !== expected.roleName
  ) return false;
  if (organizations.length !== 1) return false;
  const fixture = organizations[0];
  return fixture.id === expected.organizationId &&
    fixture.name === FIXTURE_NAME &&
    fixture.legalName === FIXTURE_LEGAL_NAME;
}

export function attestedProductionDemoOrganizationId(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  return fixtureSettings(env)?.organizationId ?? null;
}

// Must run on the SAME Drizzle transaction / PG connection as any subsequent
// fixture writes. A separate preflight alone is vulnerable to TOCTOU.
async function inspectFixture(tx: FixtureReader): Promise<DemoProvisioningBoundary> {
  if (!fixtureSettings(process.env)) return "blocked_non_demo_employer";
  const session = await tx.execute(PUBLIC_DEMO_DATABASE_IDENTITY_SQL);
  if (!verifiedPublicDemoDatabaseIdentity(session.rows[0])) return "blocked_non_demo_employer";
  const identity = normalizeRuntimeDatabaseIdentity(session.rows[0]);
  const rows = await tx.execute(sql`
    SELECT id, name, legal_name AS "legalName" FROM organizations LIMIT 2
  `);
  const candidates = rows.rows as FixtureOrganization[];
  if (candidates.length > 1 || candidates.length === 0) return "blocked_non_demo_employer";
  return isAttestedProductionDemoFixture(
    identity, candidates,
  ) ? "demo_only" : "blocked_non_demo_employer";
}

/** Read-only status-only diagnostic: a missing or failed database lookup is
 * never proof that demo account provisioning is safe. */
export async function productionDemoEmployerBoundary(): Promise<DemoProvisioningBoundary> {
  if (process.env.NODE_ENV !== "production") return "non_production";
  try {
    return await db.transaction(async (tx) => inspectFixture(tx));
  } catch {
    return "unverified";
  }
}

/** Recheck inside the lock held by ensurePublicDemoTenant's write transaction. */
export async function requireProductionDemoFixtureInTransaction(
  tx: FixtureReader,
): Promise<number> {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("PRODUCTION_DEMO_ATTESTATION_CALLED_OUTSIDE_PRODUCTION");
  }
  if (await inspectFixture(tx) !== "demo_only") {
    throw new Error("PRODUCTION_DEMO_FIXTURE_NOT_ATTESTED");
  }
  const organizationId = attestedProductionDemoOrganizationId();
  if (organizationId === null) throw new Error("PRODUCTION_DEMO_FIXTURE_NOT_ATTESTED");
  return organizationId;
}

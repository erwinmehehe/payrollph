/**
 * Whole-batch DL-02 remainder: four exact methods, two independent attackers,
 * one real higher-ID victim, real production-mode localhost HTTP and PG16.
 * Prior DL-02 credits remain untouched in their existing proof files.
 *
 * NOT an acceptance or credit generator: failed/pending CI leaves all GAPs.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, employees, organizations, userOrganizations, users, worksites,
  workforcePunchSubmissions, workforcePunchPhotoEvidence,
  workforcePunchPhotoConsents, workforceDemandImportBatches,
  workforceDemandObservationRevisions,
} from "../../src/db/schema";
import { essEmployeePhotos } from "../../src/lib/ess-profile-schema";
import {
  requireTenantTableDisposable, standaloneMakeSession, standaloneRequest,
} from "./tenant-table-http.mjs";
import * as photo from "./tenant-dl02-rows/self-photo.mjs";
import * as punch from "./tenant-dl02-rows/web-bundy.mjs";
import * as demand from "./tenant-dl02-rows/demand-import.mjs";

export const DL02_REMAINING_METHODS = Object.freeze([
  "POST /api/self/photo",
  "GET /api/web-bundy/evidence",
  "POST /api/web-bundy/evidence",
  "POST /api/workforce/demand-observations/import",
]);
assert.deepEqual(
  [...photo.METHODS, ...punch.METHODS, ...demand.METHODS].sort(),
  [...DL02_REMAINING_METHODS].sort(),
  "DL-02 family files must cover the exact four remaining method keys, once each");
const BASE = process.env.SECURITY_SMOKE_URL ?? "";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082", "hex");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function requireDl02Disposable() {
  requireTenantTableDisposable();
  const app = new URL(process.env.SECURITY_SMOKE_URL);
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(app.port, "3000");
  assert.equal(target.port, "5432");
  assert.equal(target.protocol, "postgresql:");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.DEMO_MODE, "false");
  assert.equal(process.env.TENANT_DL02_CLOSURE_PROOF, "isolated-ci-only");
  assert.equal(process.env.TENANT_TABLE_PROFILE, "allowlisted-reads");
  assert.equal(process.env.WFM_PUNCH_EVIDENCE_ENABLED, "true");
  assert.equal(process.env.WFM_OPERATIONAL_DEMAND_ENABLED, "true");
  assert.equal(process.env.DOCUMENT_UPLOADS_ENABLED, "true");
  assert.equal(process.env.TENANT_SYNTHETIC_SCAN_MODE, "isolated-pg16-only");
  assert.equal(process.env.MALWARE_SCAN_URL, "https://127.0.0.1:8443/scan");
  assert.ok((process.env.PUNCH_DEVICE_HASH_KEY ?? "").length >= 32);
  assert.ok((process.env.PII_ENCRYPTION_KEY ?? "").length >= 64);
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
}

function loadFixture() {
  const file = process.env.TENANT_DL02_CLOSURE_FIXTURE;
  assert.ok(file && file.startsWith("/tmp/payrollph-dl02-"));
  assert.equal(statSync(file).mode & 0o077, 0, "fixture cookies must stay private");
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(fixture.schema, "tenant-dl02-closure-three-employers-v1");
  assert.equal(fixture.attackers.length, 2);
  const all = [...fixture.attackers, fixture.victim];
  assert.equal(new Set(all.map(e => e.org.id)).size, 3);
  assert.deepEqual(fixture.allowlistedIds, all.map(e => e.org.id));
  for (const e of all) assert.ok(e.marker && e.cookie && e.worker.id && e.owner.id);
  assert.ok(fixture.victim.org.id > 6 &&
    fixture.victim.org.id > Math.max(...fixture.attackers.map(e => e.org.id)));
  for (const key of ["WFM_PUNCH_EVIDENCE_ORG_IDS", "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS"]) {
    assert.deepEqual((process.env[key] ?? "").split(",").map(Number), fixture.allowlistedIds,
      key + " must allowlist only these three real disposable employers");
  }
  return fixture;
}

/** Shared HTTP proof transport, including real multipart bytes. */
export async function postForm(url, cookie, fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  if (file) form.append(file.field, new Blob([file.bytes], { type: file.mime }), file.name);
  const response = await fetch(new URL(url, BASE), {
    method: "POST",
    headers: { cookie, origin: BASE, "sec-fetch-site": "same-origin" },
    body: form, redirect: "manual", cache: "no-store",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep any non-JSON denial body */ }
  return { status: response.status, bytes, text, json, headers: response.headers };
}
export function exact(response, status, label) {
  assert.equal(response.status, status,
    label + " got " + response.status + " " + response.text?.slice(0, 160));
  return response;
}
export function noVictim(response, victim, label) {
  const raw = response.text + "\n" +
    [...response.headers].map(([key, value]) => key + ":" + value).join("\n");
  assert.ok(!raw.includes(victim.marker), label + ": leaked victim marker");
  assert.ok(!raw.includes("DL02-" + victim.marker), label + ": leaked victim worker identifier");
}

async function reserveHighIds() {
  // Fixed, reviewed fixture-only sequences. No migrations and no live SQL.
  await db.execute(sql.raw(
    "SELECT setval(pg_get_serial_sequence('employees','id')," +
    " GREATEST(6, COALESCE((SELECT MAX(id) FROM employees),0)), true)"));
  await db.execute(sql.raw(
    "SELECT setval(pg_get_serial_sequence('worksites','id')," +
    " GREATEST(6, COALESCE((SELECT MAX(id) FROM worksites),0)), true)"));
  await db.execute(sql.raw(
    "SELECT setval(pg_get_serial_sequence('workforce_punch_submissions','id')," +
    " GREATEST(6, COALESCE((SELECT MAX(id) FROM workforce_punch_submissions),0)), true)"));
  await db.execute(sql.raw(
    "SELECT setval(pg_get_serial_sequence('workforce_demand_import_batches','id')," +
    " GREATEST(6, COALESCE((SELECT MAX(id) FROM workforce_demand_import_batches),0)), true)"));
}

async function makeEmployerEvidence(preseed) {
  const orgId = preseed.org.id;
  const [site] = await db.insert(worksites).values({
    organizationId: orgId, orgUnitId: preseed.unit.id,
    code: "DL02-" + preseed.label,
    name: "Fictional " + preseed.marker + " worksite",
    timezone: "Asia/Manila", active: true,
  }).returning();
  const [worker] = await db.insert(employees).values({
    organizationId: orgId, legalEntityId: preseed.entity.id, orgUnitId: preseed.unit.id,
    employeeNo: "DL02-" + preseed.marker, firstName: "Fictional",
    lastName: preseed.label + " Employee", title: "Fixture worker", avatarInitials: "DL",
    basicRate: "20000.00", startDate: "2026-01-05",
  }).returning();
  const [ess] = await db.insert(users).values({
    email: "dl02-closure-" + preseed.label.toLowerCase() + "-" + randomUUID() + "@example.invalid",
    name: "Fictional " + preseed.marker + " employee",
    passwordHash: "fixture-only-no-login",
    role: "employee", employeeId: worker.id,
  }).returning();
  await db.insert(userOrganizations).values({
    userId: ess.id, organizationId: orgId, role: "employee", active: true,
  });
  const session = await standaloneMakeSession(ess.id);
  return { ...preseed, site, worker, ess, essCookie: session.cookie };
}

export async function victimSnapshot(e) {
  const orgId = e.org.id;
  const scoped = (table) => db.select().from(table)
    .where(eq(table.organizationId, orgId));
  return {
    organization: await db.select().from(organizations).where(eq(organizations.id, orgId)),
    workers: await scoped(employees),
    worksites: await scoped(worksites),
    photos: await scoped(essEmployeePhotos),
    punches: await scoped(workforcePunchSubmissions),
    punchPhotos: await scoped(workforcePunchPhotoEvidence),
    punchConsents: await scoped(workforcePunchPhotoConsents),
    demandBatches: await scoped(workforceDemandImportBatches),
    demandRevisions: await scoped(workforceDemandObservationRevisions),
    audit: await scoped(auditEvents),
  };
}

export async function verifyDl02Closure() {
  requireDl02Disposable();
  const fixture = loadFixture();
  await reserveHighIds();
  const attackers = [];
  for (const e of fixture.attackers) attackers.push(await makeEmployerEvidence(e));
  const victim = await makeEmployerEvidence(fixture.victim);
  const ctx = {
    attackers, victim, all: [...attackers, victim], PNG,
    db, assert, postForm, request: standaloneRequest, exact, noVictim, sha256,
  };
  for (const field of ["org", "worker", "site"]) {
    const victimId = victim[field].id;
    assert.ok(Number.isSafeInteger(victimId) && victimId > 6 &&
      attackers.every(e => victimId > e[field].id),
      field + ": persisted victim ID must exceed 6 and both attackers");
  }
  // Authenticated owned positives of both attackers BEFORE exclusive victim targets.
  await photo.seedOwn(ctx);
  await punch.seedOwn(ctx);
  await demand.seedOwn(ctx);
  const victimBefore = await victimSnapshot(victim);
  // Photo denial revokes own ESS membership, so its family is executed last.
  for (const family of [punch, demand, photo]) {
    await family.verifyCrossEmployer(ctx);
    assert.deepEqual(await victimSnapshot(victim), victimBefore,
      family.METHODS.join(", ") + ": victim rows, connected evidence, audit unchanged");
  }
  console.log(JSON.stringify({
    kind: "tenant-dl02-whole-batch-proof", batchId: "DL-02",
    methods: DL02_REMAINING_METHODS.length,
    independentAttackers: 2, realVictimIdGreaterThanAttackerIds: true,
    ownMethodEvidence: true, realForeignDenial: true, forgedSelectorsChecked: true,
    victimDatabaseUnchanged: true, syntheticScannerOnly: true,
    productionTested: false, accepted: false,
  }));
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-dl02-closure-http.mjs")) {
  verifyDl02Closure().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
}

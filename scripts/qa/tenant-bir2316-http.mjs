/**
 * BIR Form 2316 tenant/legal-employer isolation — real signed-in HTTPS against
 * disposable PostgreSQL 16. No filing, production access, providers or money.
 * Source checks alone are NOT accepted as tenant-isolation proof.
 *
 * Invoked exclusively by multi-entity-browser-qa.yml, after synthetic seeding.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as s from "../../src/db/schema.ts";
import { hashPassword } from "../../src/lib/crypto.ts";
import { encryptGovernmentId } from "../../src/lib/government-id-crypto.ts";
import { annualize } from "../../src/lib/annualization.ts";
import { certificateReview } from "../../tests/fixtures/bir-2316-certificate.ts";

const ON = "https://127.0.0.1:3000";
const OFF = "https://127.0.0.1:3001";
const password = "Synthetic-2316-QA-2026-Only!";
let checks = 0;
function verifyLocal() {
  const pg = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
  assert.equal(process.env.MULTI_ENTITY_ENABLED, "true");
  assert.equal(process.env.BIR_2316_CERTIFICATE_DRAFT_ENABLED, "true");
  assert.equal(process.env.BIR_2316_RECONCILIATION_ENABLED, "true");
  assert.equal(process.env.BIR_2316_WITHHOLDING_EVIDENCE_ENABLED, "true");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.ok(["127.0.0.1", "localhost"].includes(pg.hostname));
  assert.equal(pg.protocol, "postgresql:");
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  assert.equal(process.env.APP_BASE_URL, ON);
}
function check(value, message) { assert.ok(value, message); checks++; }
function expectStatus(response, status, message) {
  assert.equal(response.status, status, message + ": got " + response.status + " / " +
    response.text.slice(0, 170)); checks++; return response;
}
async function request(context, base, path, { method = "GET", body, headers = {} } = {}) {
  assert.ok(base === ON || base === OFF);
  const response = await context.request.fetch(base + path, {
    method, failOnStatusCode: false,
    headers: { ...(method === "POST" ? {
      "Content-Type": "application/json", Origin: base, "sec-fetch-site": "same-origin",
    } : {}), ...headers },
    ...(body === undefined ? {} : { data: body }),
  });
  const bytes = Buffer.from(await response.body());
  const text = bytes.toString("utf8");
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status(), headers: response.headers(), bytes, text, json };
}
async function login(context, email, ip) {
  const response = await context.request.post(ON + "/api/auth/login", {
    headers: { "content-type": "application/json", origin: ON,
      "sec-fetch-site": "same-origin", "x-forwarded-for": ip },
    data: { email, password }, failOnStatusCode: false,
  });
  assert.equal(response.status(), 200, "Genuine synthetic password login must issue a session");
  const cookies = await context.cookies(ON);
  check(cookies.some(c => c.name === "__Host-linaw_session" && c.secure && c.httpOnly),
    "Real HTTPS must issue a Secure HttpOnly session, not an injected test identity");
}
function sourcePath(row) {
  return "/api/year-end/2316-certificate?organizationId=" + row.organizationId +
    "&employeeId=" + row.employeeId + "&taxYear=2025&separationId=" + row.id;
}
function draftPath(row) { return "/api/separation/" + row.id + "/2316"; }
function reviewForZeroAnnualization() {
  const review = certificateReview();
  // Every zero is an explicit reviewer mapping for this zero-ledger fictional
  // final-pay source; the server still validates every item and tax calculation.
  review.detailItems = Object.fromEntries(Object.keys(review.detailItems)
    .map(key => [key, "0.00"]));
  return review;
}
async function snapshotVictim(orgId) {
  return {
    separation: await db.select().from(s.separationRecords)
      .where(eq(s.separationRecords.organizationId, orgId)).orderBy(s.separationRecords.id),
    employees: await db.select().from(s.employees)
      .where(eq(s.employees.organizationId, orgId)).orderBy(s.employees.id),
    audit: await db.select().from(s.auditEvents)
      .where(eq(s.auditEvents.organizationId, orgId)).orderBy(s.auditEvents.id),
  };
}
async function seed() {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 8);
  const organizations = await db.insert(s.organizations).values([
    { name: "BIR QA Attacker A " + nonce, legalName: "BIR QA Attacker A " + nonce,
      birTin: "123456789", birBranchCode: "0000", plan: "Core" },
    { name: "BIR QA Attacker B " + nonce, legalName: "BIR QA Attacker B " + nonce,
      birTin: "234567890", birBranchCode: "0000", plan: "Core" },
    { name: "BIR QA Victim " + nonce, legalName: "BIR QA Victim " + nonce,
      birTin: "345678901", birBranchCode: "0000", plan: "Core" },
  ]).returning();
  check(new Set(organizations.map(x => x.id)).size === 3,
    "Two independent attackers and third victim must exist in PostgreSQL");
  const entities = await db.insert(s.legalEntities).values([
    { organizationId: organizations[0].id, code: "QA-PRIMARY", primaryEntity: true,
      legalName: "BIR QA Original Employer A " + nonce,
      displayName: "BIR QA Original Employer A", birTin: "123456789", birBranchCode: "0000" },
    { organizationId: organizations[0].id, code: "QA-OTHER",
      legalName: "BIR QA Other Employer A " + nonce,
      displayName: "BIR QA Other Employer A", birTin: "456789012", birBranchCode: "0001" },
    { organizationId: organizations[1].id, code: "QA-PRIMARY", primaryEntity: true,
      legalName: "BIR QA Original Employer B " + nonce,
      displayName: "BIR QA Original Employer B", birTin: "234567890", birBranchCode: "0000" },
    { organizationId: organizations[1].id, code: "QA-OTHER",
      legalName: "BIR QA Other Employer B " + nonce,
      displayName: "BIR QA Other Employer B", birTin: "567890123", birBranchCode: "0001" },
    { organizationId: organizations[2].id, code: "QA-PRIMARY", primaryEntity: true,
      legalName: "BIR QA Victim Employer " + nonce,
      displayName: "BIR QA Victim Employer", birTin: "345678901", birBranchCode: "0000" },
  ]).returning();
  const pwHash = hashPassword(password);
  const personas = organizations.flatMap((org, idx) => [0, 1, 2].map(k => ({
    organizationId: org.id, idx, k,
    email: "bir2316-qa-" + nonce + "-" + idx + "-" + k + "@example.test",
    role: ["owner", "payroll", "admin"][k],
  })));
  const people = await db.insert(s.users).values(personas.map(p => ({
    email: p.email, name: "Fictional 2316 actor " + nonce + "-" + p.idx + "-" + p.k,
    role: p.role, passwordHash: pwHash,
  }))).returning();
  await db.insert(s.userOrganizations).values(people.map((user,i) => ({
    organizationId: personas[i].organizationId, userId: user.id,
    role: personas[i].role, active: true,
  })));
  const grantRows = [0, 1, 2].map(idx => ({
    organizationId: organizations[idx].id, userId: people[idx * 3].id,
    legalEntityId: [entities[0].id, entities[2].id, entities[4].id][idx],
  }));
  await db.insert(s.userLegalEntityGrants).values(grantRows);
  const workerTemplates = [
    { org: organizations[0], entity: entities[0], marker: "OWN-A" },
    { org: organizations[1], entity: entities[2], marker: "OWN-B" },
    { org: organizations[0], entity: entities[1], marker: "OTHER-A" },
    { org: organizations[1], entity: entities[3], marker: "OTHER-B" },
    { org: organizations[2], entity: entities[4], marker: "VICTIM-ONLY" },
  ];
  const workers = await db.insert(s.employees).values(workerTemplates.map((row,i) => ({
    organizationId: row.org.id, legalEntityId: row.entity.id,
    employeeNo: "BIR-QA-" + row.marker + "-" + nonce,
    firstName: row.marker, lastName: "Fictional", title: "Synthetic worker",
    avatarInitials: "QA", basicRate: "20000.00",
    tin: encryptGovernmentId("20000000" + (i + 1), { required: true }),
    tinBranchCode: encryptGovernmentId("0000", { required: true }),
    birthDate: "1990-02-03", startDate: "2025-01-01",
  }))).returning();
  const annualization = annualize({
    grossCompensation: 0, thirteenthMonth: 0,
    statutoryContributions: 0, taxWithheld: 0, mwe: false,
  });
  check(annualization.taxDue === 0 && annualization.adjustment === 0,
    "Fictional source must not contain funds to transfer or file");
  const separationValues = workers.map((worker,i) => {
    const ix = i === 0 || i === 2 ? 0 : i === 1 || i === 3 ? 1 : 2;
    const actors = people.slice(ix * 3, ix * 3 + 3);
    return {
      organizationId: worker.organizationId, employeeId: worker.id,
      separationType: "resignation", noticeDate: "2025-12-01",
      lastDay: "2025-12-15", status: "released",
      releasedAt: new Date("2025-12-20T04:00:00.000Z"),
      releaseReference: "FICTIONAL-2316-" + nonce + "-" + i,
      preparedByUserId: actors[0].id, approvedByUserId: actors[1].id,
      releasedByUserId: actors[2].id,
      grossFinalPay: "0.00", netFinalPay: "0.00",
      taxAdjustment: "0.00", finalStatutoryDeductions: "0.00",
      loanDeductions: "0.00",
      computationSnapshot: {
        annualization, appliedTaxCollection: "0.00",
        unpaidTaxWithholding: "0.00",
        sourceFingerprint: { employeeLegalEntityId: worker.legalEntityId, released: [] },
      },
    };
  });
  const separations = await db.insert(s.separationRecords).values(separationValues).returning();
  const rows = separations.map((separation,i) => ({
    ...separation, entityId: workerTemplates[i].entity.id,
    employeeNo: workers[i].employeeNo, marker: workerTemplates[i].marker,
  }));
  for(const index of [0, 1]) {
    const row = await db.select().from(s.separationRecords)
      .where(eq(s.separationRecords.id, rows[index].id));
    check(row.length === 1 && row[0].organizationId === organizations[index].id,
      "Owned separation must actually exist in PostgreSQL");
  }
  check(rows[4].id > 6 && rows[4].id > rows[0].id && rows[4].id > rows[1].id,
    "Actual victim-only separation ID must exceed both owned IDs and 6");
  check(rows[4].employeeId > workers[0].id && rows[4].employeeId > workers[1].id,
    "Actual victim worker ID must exceed both owned worker IDs");
  const [persistedVictim] = await db.select().from(s.separationRecords)
    .where(eq(s.separationRecords.id, rows[4].id));
  check(persistedVictim?.organizationId === organizations[2].id &&
    persistedVictim.employeeId === workers[4].id,
    "Victim evidence must be persisted, never a made-up ID");
  return { organizations, entities, people, workers, rows, grantRows };
}

verifyLocal();
const fixture = await seed();
const browser = await chromium.launch({ headless: true });
const contexts = [];
try {
  const callers = [];
  for (let idx = 0; idx < 3; idx++) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    contexts.push(context);
    await login(context, fixture.people[idx * 3].email, "198.51.100." + (41 + idx));
    callers.push(context);
  }
  const victimRow = fixture.rows[4];
  const victimContext = callers[2];
  // The victim's own real authenticated success proves these targets exist.
  const victimOwned = expectStatus(await request(victimContext, ON, draftPath(victimRow)),
    200, "Victim-owned final-pay draft contains actual source evidence");
  check(victimOwned.text.includes(victimRow.employeeNo), "Victim draft must be nonempty");
  const victimSource = expectStatus(await request(victimContext, ON, sourcePath(victimRow)),
    200, "Victim-owned 2316 source belongs to an actual fictional worker");
  check(victimSource.json?.source?.legalEntityId === victimRow.entityId,
    "Victim's source must use verified frozen legal employer");
  const victimPdf = expectStatus(await request(victimContext, ON, sourcePath(victimRow), {
    method: "POST", body: {
      sourceDigest: victimSource.json.sourceDigest, review: reviewForZeroAnnualization(),
    },
  }), 200, "Victim-owner may generate its own unsigned 2316 PDF");
  check(victimPdf.bytes.subarray(0, 4).toString("ascii") === "%PDF",
    "A 200 with empty JSON is not successful PDF proof");
  const victimBefore = await snapshotVictim(fixture.organizations[2].id);

  for (const idx of [0, 1]) {
    const context = callers[idx];
    const own = fixture.rows[idx], other = fixture.rows[idx + 2];
    const victim = fixture.rows[4];
    const originalEmployer = fixture.entities[idx === 0 ? 0 : 2];
    const otherEmployer = fixture.entities[idx === 0 ? 1 : 3];

    const ownDraft = expectStatus(await request(context, ON, draftPath(own)),
      200, "BIR 2316 draft GET: owned, released, populated source");
    check(ownDraft.text.includes(own.employeeNo) &&
      ownDraft.text.includes(originalEmployer.legalName) &&
      ownDraft.text.includes("DRAFT"),
      "Own offboarding draft must contain employer-accurate source text");

    const ownSource = expectStatus(await request(context, ON, sourcePath(own)),
      200, "BIR 2316 source GET: owned, nonempty employer source");
    check(ownSource.json?.source?.legalEntityId === own.entityId &&
      ownSource.json?.source?.scope?.employeeId === own.employeeId &&
      /^[0-9a-f]{64}$/.test(ownSource.json?.sourceDigest ?? ""),
      "Owner source and digest must be produced for the persisted owned worker");

    const ownPdf = expectStatus(await request(context, ON, sourcePath(own), {
      method: "POST", body: {
        sourceDigest: ownSource.json.sourceDigest, review: reviewForZeroAnnualization(),
      },
    }), 200, "BIR 2316 POST: real unsigned PDF generated for owned employee");
    check(ownPdf.bytes.subarray(0, 4).toString("ascii") === "%PDF" &&
      ownPdf.bytes.length > 2000 &&
      /application\/pdf/.test(ownPdf.headers["content-type"] ?? "") &&
      /no-store/.test(ownPdf.headers["cache-control"] ?? ""),
      "Own POST must return actual private unsigned PDF bytes, not empty/failed response");

    const foreignDraft = expectStatus(await request(context, ON, draftPath(victim)),
      403, "BIR 2316 draft GET: actual high-ID victim of a different tenant denied");
    const foreignSource = expectStatus(await request(context, ON, sourcePath(victim)),
      403, "BIR 2316 source GET: real victim employee/separation and organization denied");
    const foreignPdf = expectStatus(await request(context, ON, sourcePath(victim), {
      method: "POST", body: {
        sourceDigest: ownSource.json.sourceDigest, review: reviewForZeroAnnualization(),
      },
    }), 403, "BIR 2316 POST: real victim source and PDF denied to foreign tenant");
    for (const result of [foreignDraft, foreignSource, foreignPdf]) {
      check(!result.text.includes("VICTIM-ONLY") &&
        !result.text.includes(fixture.entities[4].legalName),
        "Foreign denial cannot serialize victim employer, worker or certificate");
    }
    expectStatus(await request(context, ON, draftPath(victim) +
      "?organizationId=" + own.organizationId + "&employeeId=" + own.employeeId),
      403, "Forged own query must not override victim's stored separation organization");
    expectStatus(await request(context, ON, sourcePath(own) +
      "&legalEntityId=" + victim.entityId), 403,
      "Forged query legal employer must be rejected");
    expectStatus(await request(context, ON, draftPath(own), {
      headers: { "x-legal-entity-id": String(victim.entityId) },
    }), 403, "Forged header legal employer on offboarding draft rejected");

    expectStatus(await request(context, ON, draftPath(other)),
      403, "Same-tenant other legal employer's offboarding draft denied");
    expectStatus(await request(context, ON, sourcePath(other)),
      403, "Same-tenant other legal employer's 2316 source denied");
    expectStatus(await request(context, ON, sourcePath(other), {
      method: "POST", body: {
        sourceDigest: ownSource.json.sourceDigest, review: reviewForZeroAnnualization(),
      },
    }), 403, "Same-tenant other legal employer's unsigned PDF denied");
    expectStatus(await request(context, ON, sourcePath(own), {
      headers: { "x-legal-entity-id": String(otherEmployer.id) },
    }), 403, "Ungrantable other-employer selector denied before tax data");

    // Employee transfer after final pay cannot rewrite frozen historical
    // employer attribution or create a grant for the destination employer.
    await db.update(s.employees).set({ legalEntityId: otherEmployer.id })
      .where(and(eq(s.employees.id, own.employeeId),
        eq(s.employees.organizationId, own.organizationId)));
    const transferredDraft = expectStatus(await request(context, ON, draftPath(own)),
      200, "Transferred employee retains original frozen employer's document");
    check(transferredDraft.text.includes(originalEmployer.legalName) &&
      !transferredDraft.text.includes(otherEmployer.legalName),
      "Historical employer must stay frozen after legal-employer transfer");
    const transferredSource = expectStatus(await request(context, ON, sourcePath(own)),
      200, "Transferred employee source must use prior employer's final-pay fingerprint");
    check(transferredSource.json?.source?.legalEntityId === originalEmployer.id,
      "New employee assignment is not authority over a previous employer");
    expectStatus(await request(context, OFF, draftPath(own)), 200,
      "Flag-OFF offboarding text output must preserve existing single-workspace behavior");
    expectStatus(await request(context, OFF, sourcePath(own)), 404,
      "Flag-OFF unsigned certificate feature remains disabled, not activated globally");

    // Proven revocation must be enforced against the same signed-in account.
    await db.delete(s.userLegalEntityGrants).where(and(
      eq(s.userLegalEntityGrants.organizationId, own.organizationId),
      eq(s.userLegalEntityGrants.userId, fixture.people[idx * 3].id),
      eq(s.userLegalEntityGrants.legalEntityId, originalEmployer.id),
    ));
    expectStatus(await request(context, ON, draftPath(own)), 403,
      "Revoked historical employer grant denies existing signed-in draft access");
    expectStatus(await request(context, ON, sourcePath(own)), 403,
      "Revoked historical employer grant denies existing signed-in source access");
    expectStatus(await request(context, ON, sourcePath(own), {
      method: "POST", body: {
        sourceDigest: ownSource.json.sourceDigest, review: reviewForZeroAnnualization(),
      },
    }), 403, "Revoked historical employer grant denies existing signed-in PDF generation");
    const victimAfter = await snapshotVictim(fixture.organizations[2].id);
    assert.deepEqual(victimAfter, victimBefore,
      "Real victim separation, worker and audit rows must stay unchanged by attacker GET/POST and forged selectors"); checks++;
    console.log("PASS BIR2316 real HTTPS/PG16 attacker " + (idx+1) +
      ": owned draft/source/PDF, other-employer and victim denied, transfer frozen, revocation enforced");
  }
  console.log(JSON.stringify({ result: "PASS", evidence: "AUTHENTICATED_REAL_HTTPS_DISPOSABLE_PG16",
    methods: ["GET separation/[id]/2316", "GET year-end/2316-certificate",
      "POST year-end/2316-certificate"],
    attackerOrganizations: 2, victimOrganizations: 1, persistedVictimIdAboveBoth: true,
    checks, issuerSigned: false, externalFiling: false, moneyMoved: false,
    providerCalls: 0, wholeSystemTenantIsolationAccepted: false }));
} finally {
  await Promise.all(contexts.map(c => c.close()));
  await browser.close();
}

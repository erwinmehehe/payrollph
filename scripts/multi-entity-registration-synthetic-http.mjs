import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import pg from "pg";

// This is a local-only synthetic review of the sealed registration workflow.
// It does not grant production MFA, DBA, bank or legal approvals.
const base = "https://127.0.0.1:3002";
const password = "Synthetic-Entity-QA-2026-Only!";
// Reserved TEST-NET addresses represent distinct fictional remote test users.
// Only the disposable localhost runner trusts this single synthetic proxy hop.
const syntheticLoginIp = email => {
  const personas = [
    "entity-group@example.test", "entity-group-unit@example.test",
    "entity-owner@example.test", "entity-hr@example.test",
    "entity-payroll@example.test", "entity-nogrant@example.test",
    "entity-foreign@example.test", "entity-checker@example.test",
  ];
  const index = personas.indexOf(email);
  assert.notEqual(index, -1, "Unknown synthetic login persona");
  return "198.51.100." + (index + 11);
};

assert.equal(process.env.CI, "true");
assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
assert.equal(process.env.MULTI_ENTITY_ENABLED, "true");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(dbUrl.hostname) && dbUrl.pathname === "/app_db");
await mkdir("qa-artifacts/multi-entity", { recursive: true });

const browser = await chromium.launch({ headless: true });
const newSyntheticContext = options => browser.newContext({ ignoreHTTPSErrors: true, ...options });
const checks = [];
async function login(context, email) {
  const response = await context.request.post(base + "/api/auth/login", {
    headers: { Origin: base, "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": syntheticLoginIp(email) },
    data: { email, password }, failOnStatusCode: false,
  });
  assert.equal(response.status(), 200, "Synthetic account login failed for " + email);
  const session = (await context.cookies(base)).find(c => c.name === "__Host-linaw_session");
  assert.ok(session?.secure && session?.httpOnly,
    "Registration acceptance requires a real HttpOnly Secure __Host- session");
}
async function request(context, path, method = "GET", data = undefined) {
  const response = await context.request.fetch(base + path, {
    method,
    headers: method === "GET" ? undefined :
      { Origin: base, "Content-Type": "application/json", "sec-fetch-site": "same-origin" },
    data, failOnStatusCode: false,
  });
  return { status: response.status(), json: await response.json().catch(() => null) };
}
async function selection(ctx, id) {
  const r = await request(ctx, "/api/multi-entity/context", "PATCH", { organizationId: 1, legalEntityId: id });
  assert.equal(r.status, 200, "Explicit employer selection required");
}
function list(ctx, legalEntityId) {
  return request(ctx, "/api/multi-entity/registration-changes?organizationId=1&legalEntityId=" + legalEntityId);
}
async function routeToEntities(page) {
  const res = await page.goto(base + "/app?organizationId=1", { waitUntil: "load", timeout: 60000 });
  assert.equal(res?.status(), 200);
  await page.locator('[data-workspace-page="Overview"]').waitFor({ timeout: 60000 });
  if ((page.viewportSize()?.width ?? 1000) < 550) {
    // The drawer is client-controlled. SSR content may paint before its click
    // handler hydrates: require a real drawer-open transition before continuing.
    const trigger = page.getByRole("button", { name: "Open navigation" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await trigger.click();
      try {
        await page.locator(".app-shell.drawer-open").waitFor({ timeout: 3500 });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }
  const entityLink = page.locator('.sidebar [data-nav-name="Entities"]');
  const more = page.locator(".sidebar .nav-more-toggle");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await entityLink.isVisible()) break;
    await more.click();
    try {
      await entityLink.waitFor({ state: "visible", timeout: 3500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await entityLink.click();
  await page.locator('[data-workspace-page="Entities"]').waitFor({ timeout: 30000 });
  await page.getByRole("heading", { name: "Propose a new employer registration version" })
    .waitFor({ timeout: 30000 });
}

try {
  const maker = await newSyntheticContext({ viewport: { width: 1440, height: 900 } });
  const checker = await newSyntheticContext({ viewport: { width: 390, height: 844 } });
  const group = await newSyntheticContext();
  const foreign = await newSyntheticContext();
  await login(maker, "entity-owner@example.test");
  await login(checker, "entity-checker@example.test");
  await login(group, "entity-group@example.test");
  await login(foreign, "entity-foreign@example.test");

  const entities = await request(maker, "/api/multi-entity/context?organizationId=1");
  assert.equal(entities.status, 200, "Initial authorized entity context must load");
  const selected = entities.json.entities.find(e => e.code === "SECOND");
  assert.ok(selected);
  await selection(maker, selected.id);
  await selection(checker, selected.id);

  const before = await list(maker, selected.id);
  assert.equal(before.status, 200);
  assert.equal(before.json.versions.length, 0);
  assert.equal(before.json.requests.length, 0);
  const today = before.json.today;
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);

  assert.equal((await list(group, selected.id)).status, 403);
  assert.equal((await list(foreign, selected.id)).status, 403);
  checks.push("Dedicated group HR and foreign-tenant identities cannot fetch registration changes");

  const invalid = await request(maker, "/api/multi-entity/registration-changes", "POST", {
    organizationId: 1, legalEntityId: selected.id, effectiveDate: today,
    reason: "Synthetic malformed bank proposal",
    changes: { disbursementAccount: "123456789012" },
  });
  assert.equal(invalid.status, 422, "Incomplete bank destination must be rejected");
  checks.push("Partial bank fields rejected");

  const propose = await request(maker, "/api/multi-entity/registration-changes", "POST", {
    organizationId: 1, legalEntityId: selected.id, effectiveDate: today,
    reason: "Synthetic verified legal name change",
    changes: { legalName: "Beta Legal Employer QA Approved" },
  });
  assert.equal(propose.status, 201);
  const requestId = propose.json.id;
  assert.ok(Number.isSafeInteger(requestId) && requestId > 0);
  // Assert the optimistic-lock token is the SAME PostgreSQL timestamp, not
  // a JavaScript Date round-trip truncated to milliseconds. This test is
  // restricted above to a disposable localhost database and synthetic users.
  const localDb = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await localDb.connect();
  try {
    const stamp = await localDb.query(`
      SELECT e.updated_at = r.expected_entity_updated_at AS exact_match,
        (extract(microseconds FROM e.updated_at)::integer % 1000) AS submillisecond
      FROM legal_entity_profile_change_requests r
      JOIN legal_entities e
        ON e.organization_id = r.organization_id AND e.id = r.legal_entity_id
      WHERE r.id = $1 AND r.organization_id = $2 AND r.legal_entity_id = $3
    `, [requestId, 1, selected.id]);
    assert.equal(stamp.rows.length, 1, "Synthetic source version must exist");
    assert.equal(stamp.rows[0].submillisecond, 437,
      "Fixture must exercise PostgreSQL microseconds that a JS Date loses");
    assert.equal(stamp.rows[0].exact_match, true,
      "Registration source timestamp must preserve PostgreSQL microseconds");
    checks.push("Unrounded PostgreSQL optimistic-lock token persisted exactly");
  } finally {
    await localDb.end();
  }
  const makerView = await list(maker, selected.id);
  assert.equal(makerView.json.requests.length, 1);
  assert.equal(makerView.json.requests[0].canReview, false);
  assert.ok(!JSON.stringify(makerView.json).includes("profileEnvelope"));
  const ownDecision = await request(maker, "/api/multi-entity/registration-changes", "PATCH", {
    organizationId: 1, legalEntityId: selected.id, requestId, action: "approve",
  });
  assert.equal(ownDecision.status, 409, "Maker must not approve their own version");
  checks.push("Maker cannot approve a sealed source request");

  const checkerBefore = await list(checker, selected.id);
  assert.equal(checkerBefore.status, 200, "Checker must read the pending registration request");
  assert.equal(checkerBefore.json.requests.find(x => x.id === requestId)?.canReview, true);
  const cp = await checker.newPage();
  await routeToEntities(cp);
  await cp.getByText(new RegExp("Request " + requestId + " . pending_approval")).waitFor({ timeout: 20000 });
  await cp.screenshot({ path: "qa-artifacts/multi-entity/registration-checker-pending-390.png", fullPage: true });
  const approved = await request(checker, "/api/multi-entity/registration-changes", "PATCH", {
    organizationId: 1, legalEntityId: selected.id, requestId, action: "approve",
  });
  assert.equal(approved.status, 200, "Independent checker must approve registration request");
  assert.equal(approved.json.status, "approved");
  assert.equal(approved.json.revision, 1);
  assert.equal((await request(checker, "/api/multi-entity/registration-changes", "PATCH", {
    organizationId: 1, legalEntityId: selected.id, requestId, action: "approve",
  })).status, 409, "Duplicate review must be idempotent and denied");
  const after = await list(maker, selected.id);
  assert.equal(after.json.versions.length, 1);
  assert.equal(after.json.versions[0].revision, 1);
  assert.equal(after.json.requests[0].status, "approved");
  assert.ok(!JSON.stringify(after.json).includes("profileEnvelope"));
  const projected = await request(maker, "/api/multi-entity/settings?organizationId=1");
  assert.equal(projected.status, 200, "Approved legal name must be readable in employer settings");
  assert.equal(projected.json.entities.find(e => e.id === selected.id)?.legalName, "Beta Legal Employer QA Approved");
  checks.push("Two-user maker/checker, immutable version 1, stale replay denial, projection update");

  const account = "9876543210123456"; // fictional account, never connect to money movement
  const bankProposal = await request(maker, "/api/multi-entity/registration-changes", "POST", {
    organizationId: 1, legalEntityId: selected.id, effectiveDate: today,
    reason: "Synthetic replacement of bank destination",
    changes: {
      disbursementBankCode: "BPI", disbursementAccountName: "Synthetic Employer",
      disbursementAccount: account,
    },
  });
  assert.equal(bankProposal.status, 201);
  const bankId = bankProposal.json.id;
  assert.ok(!JSON.stringify(bankProposal.json).includes(account));
  const queued = await list(checker, selected.id);
  assert.equal(queued.json.requests.find(x => x.id === bankId)?.canReview, true);
  assert.ok(!JSON.stringify(queued.json).includes(account));
  const bankApproved = await request(checker, "/api/multi-entity/registration-changes", "PATCH", {
    organizationId: 1, legalEntityId: selected.id, requestId: bankId, action: "approve",
  });
  assert.equal(bankApproved.status, 200);
  assert.equal(bankApproved.json.revision, 2);
  const bankProjection = await request(maker, "/api/multi-entity/settings?organizationId=1");
  const record = bankProjection.json.entities.find(e => e.id === selected.id);
  assert.equal(record.disbursementBankCode, "BPI");
  assert.equal(record.disbursementAccountName, "Synthetic Employer");
  assert.ok(typeof record.disbursementAccount === "string" && record.disbursementAccount.includes("3456"));
  assert.ok(!JSON.stringify(bankProjection.json).includes(account));
  const groupSettings = await request(group, "/api/multi-entity/settings?organizationId=1");
  assert.equal(groupSettings.status, 200, "Group HR must read redacted employer settings");
  for (const item of groupSettings.json.entities) {
    assert.equal(item.disbursementBankCode, "");
    assert.equal(item.disbursementAccountName, "");
    assert.equal(item.disbursementAccount, null);
  }
  const bankVersions = await list(maker, selected.id);
  assert.deepEqual(bankVersions.json.versions.map(x => x.revision), [2, 1]);
  assert.ok(!JSON.stringify(bankVersions.json).includes(account));
  checks.push("Encrypted fictional bank destination approved into version 2, masked on reads");

  const mp = await maker.newPage();
  await routeToEntities(mp);
  await mp.getByText(/Revision 2/).waitFor({ timeout: 20000 });
  await mp.screenshot({ path: "qa-artifacts/multi-entity/registration-approved-1440.png", fullPage: true });
  await cp.reload({ waitUntil: "domcontentloaded" });
  await cp.locator('[data-workspace-page="Overview"]').waitFor({ timeout: 60000 });

  // A REAL concurrent employer edit must still invalidate a pending proposal.
  // Change only the synthetic timestamp by a single microsecond so an unsafe
  // JavaScript millisecond comparison would miss the collision.
  const staleProposal = await request(maker, "/api/multi-entity/registration-changes", "POST", {
    organizationId: 1, legalEntityId: selected.id, effectiveDate: today,
    reason: "Synthetic concurrent employer revision",
    changes: { legalName: "Unapproved Stale Synthetic Employer" },
  });
  assert.equal(staleProposal.status, 201, "Stale-write regression proposal must be created");
  const concurrent = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await concurrent.connect();
  try {
    const changed = await concurrent.query(
      "UPDATE legal_entities SET updated_at = updated_at + interval '1 microsecond' " +
      "WHERE organization_id = $1 AND id = $2 RETURNING id",
      [1, selected.id],
    );
    assert.equal(changed.rowCount, 1, "Synthetic concurrent update must affect one employer");
  } finally {
    await concurrent.end();
  }
  const staleApproval = await request(checker, "/api/multi-entity/registration-changes", "PATCH", {
    organizationId: 1, legalEntityId: selected.id,
    requestId: staleProposal.json.id, action: "approve",
  });
  assert.equal(staleApproval.status, 409,
    "Concurrent microsecond-only source revision must invalidate approval");
  const deniedHistory = await list(maker, selected.id);
  assert.deepEqual(deniedHistory.json.versions.map(x => x.revision), [2, 1]);
  assert.equal(deniedHistory.json.requests.find(x => x.id === staleProposal.json.id)?.status,
    "pending_approval", "Stale decision must never approve or seal a version");
  const deniedProjection = await request(maker, "/api/multi-entity/settings?organizationId=1");
  assert.equal(deniedProjection.json.entities.find(e => e.id === selected.id)?.legalName,
    "Beta Legal Employer QA Approved", "Stale approval must not change the legal identity");
  checks.push("Concurrent sub-millisecond employer update fails closed without a new version");

  // Flag-on view retains a visible audited version history; no raw bank digits.
  console.log(JSON.stringify({
    result: "PASS", mode: "synthetic-postgres-only", checks,
    realBankOrPayrollTouched: false, realMfaAccepted: false,
    protectedCloneMigrationAccepted: false, realHumanApproval: false,
  }));
} catch (e) {
  console.error("Registration synthetic acceptance failed (" +
    (e instanceof Error ? e.message : "unknown") + ").");
  process.exitCode = 1;
} finally {
  await browser.close();
}

import assert from "node:assert/strict";
import pg from "pg";

/**
 * Strict page proof, not an empty-page or feature-disabled false positive.
 * Two independent, actually HR-scoped sessions may read only their own employer
 * even when the higher-ID victim is INCLUDED in the enabled rollout allowlist.
 * Exact persisted victim worker, provisioning, payroll and audit rows remain
 * unchanged after authenticated foreign navigation.
 */
export async function verifyIndependentPeopleHomeTenantProof({ browser, base, login }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.HCM_PEOPLE_HOME_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(base, "http://127.0.0.1:3000");
  assert.equal(process.env.HCM_PEOPLE_HOME_ORG_IDS, "1,2,3", "real victim must be enabled");
  assert.equal(process.env.DATABASE_URL,
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  const victimId = 3;
  const victimSnapshot = async () => {
    const entries = [];
    // pg.Client does not support concurrent query() calls on one connection.
    for (const table of ["employees", "provisioning_tasks", "payroll_runs", "audit_events"]) {
      const result = await database.query(
        "SELECT * FROM " + table + " WHERE organization_id=$1 ORDER BY id", [victimId]);
      entries.push([table, result.rows]);
    }
    return Object.fromEntries(entries);
  };
  try {
    const victimOrg = await database.query("SELECT id,name FROM organizations WHERE id=$1", [victimId]);
    const victimEmployee = await database.query(
      "SELECT id,employee_no FROM employees WHERE organization_id=$1", [victimId]);
    assert.deepEqual(victimOrg.rows, [{ id: 3, name: "Synthetic Victim Only Employer" }],
      "The victim must be a real persisted and fully allowlisted employer");
    assert.equal(victimEmployee.rows.length, 1);
    assert.equal(victimEmployee.rows[0].employee_no, "VICTIM-ONLY-003");
    const ownIds = await database.query("SELECT id FROM organizations WHERE id IN (1,2) ORDER BY id");
    assert.deepEqual(ownIds.rows.map(item => item.id), [1, 2]);
    assert.ok(victimId > ownIds.rows[1].id && victimEmployee.rows[0].id > 3,
      "Higher-ID victim-only worker cannot be guessed from an empty tenant");
    const before = await victimSnapshot();
    const expected = [
      { id: 1, email: "hcm-attacker-alpha@example.test",
        employer: "Synthetic Alpha Employer", workflow: "Transfer" },
      { id: 2, email: "hcm-attacker-beta@example.test",
        employer: "Synthetic Beta Employer", workflow: "Hire" },
    ];

    for (const actor of expected) {
      const membership = await database.query(
        "SELECT uo.organization_id,uo.role,uo.active FROM user_organizations uo " +
        "JOIN users u ON u.id=uo.user_id WHERE u.email=$1", [actor.email]);
      assert.deepEqual(membership.rows, [{
        organization_id: actor.id, role: "hr", active: true,
      }], "Each attacker must have real HR access only to their own employer");
    }

    for (const actor of expected) {
      const context = await browser.newContext();
      try {
        await login(context, actor.email);
        const page = await context.newPage();
        const ownPage = await page.goto(base + "/hcm/command-center?organizationId=" + actor.id, { waitUntil: "domcontentloaded" });
        assert.equal(ownPage?.status(), 200, "Real HR session must load own People Home");
        // Next SSR/RSC streams: domcontentloaded can precede completed server-rendered HTML.
        // Wait for *actual* own employer + source data rather than accepting a 200 shell.
        const home = page.locator("main").filter({ has: page.getByRole("heading", { name: "People Home", exact: true }) }).last();
        await home.getByText(actor.employer, { exact: false }).first().waitFor({ timeout: 30000 });
        await home.getByText(actor.workflow, { exact: false }).first().waitFor({ timeout: 30000 });
        const ownHtml = (await home.textContent()) ?? ""; // Preserve persisted case; CSS text-transform affects innerText.
        assert.ok(ownHtml.includes(actor.employer), "Persisted own employer name must render");
        assert.ok(ownHtml.includes(actor.workflow), "Nonempty own HCM source row must render");
        assert.ok(ownHtml.includes("People Ops follow-ups"),
          "Must render genuine own follow-up section, not an empty error shell");
        assert.ok(!ownHtml.includes("Synthetic Victim Only Employer"));
        assert.ok(!ownHtml.includes("VICTIM-ONLY-003"));
        assert.ok(!ownHtml.includes("VictimExclusive"));

        const foreignPage = await page.goto(base + "/hcm/command-center?organizationId=" + victimId, { waitUntil: "domcontentloaded" });
        assert.equal(foreignPage?.status(), 404,
          "The allowlisted, populated, real victim MUST be denied to an authenticated foreign HR user");
        const foreignHtml = await page.content();
        for (const marker of ["Synthetic Victim Only Employer", "VICTIM-ONLY-003",
          "VictimExclusive", "VictimExclusive follow-up"]) {
          assert.ok(!foreignHtml.includes(marker), "Foreign response must not leak victim-only data");
        }
      } finally { await context.close(); }
    }
    assert.deepEqual(await victimSnapshot(), before,
      "Both authorized and foreign page requests must leave every victim source, payroll and audit row unchanged");
    console.log(JSON.stringify({ kind: "hcm-people-home-provisional-page-proof",
      attackers: 2, signedIn: true, ownHtml200WithSourceData: true,
      victimFeatureEnabled: true, foreignHtml404: true,
      realVictimHigherIds: true, victimDbUnchanged: true,
      productionTested: false, globallyCertified: false }));
  } finally { await database.end(); }
}

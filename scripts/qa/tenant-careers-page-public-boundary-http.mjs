/**
 * PUBLIC Careers SSR selector and employer publication isolation.
 * Read-only, zero-credit, fictional three-employer PG16 + localhost HTTP.
 * Run only after the original EDG-01 publish/unpublish proof. It must not
 * mutate even the synthetic employers or claim any private tenant grant.
 */
import assert from "node:assert/strict";
import { requireDisposableCareersEnv } from "./tenant-edg01-careers-publication-contract.mjs";

async function run() {
  requireDisposableCareersEnv(); // fail closed before any database/module import
  const [{ db, pool }, schema, orm, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  fixture.requireTenantTableDisposable();
  const { asc } = orm;
  const pg = await pool.query("show server_version_num");
  assert.equal(Math.floor(Number(pg.rows[0].server_version_num) / 10000), 16,
    "PUBLIC_CAREERS_PAGE_REFUSED: disposable PostgreSQL 16 required");
  try {
    const employers = await db.select({
      id: schema.organizations.id, name: schema.organizations.name,
    }).from(schema.organizations).orderBy(asc(schema.organizations.id));
    assert.equal(employers.length, 3, "must reuse the three original fictional EDG-01 employers");
    for (const [index, prefix] of ["TTBL-ATTA-", "TTBL-ATTB-", "TTBL-VICTIM-"].entries()) {
      assert.ok(employers[index].name.startsWith(prefix), "original fictional employer mismatch");
    }
    const rows = (await pool.query(
      "select id, organization_id, title, careers_published, status " +
      "from job_requisitions order by id"
    )).rows;
    const victim = employers[2];
    const victimPublic = rows.filter(row =>
      row.organization_id === victim.id && row.careers_published === true && row.status === "open");
    assert.equal(victimPublic.length, 1, "higher-ID victim must have one actually published job");
    assert.ok(victimPublic[0].id > 6, "proof must use higher-ID source requisition");
    for (const owner of employers.slice(0, 2)) {
      assert.equal(rows.filter(row =>
        row.organization_id === owner.id && row.careers_published === true).length, 0,
        "both attacker jobs must really have been unpublished by existing EDG-01 proof");
    }
    const snapshotTables = [
      "organizations", "job_requisitions", "job_applicants",
      "audit_events", "payroll_runs", "employees",
    ];
    const snapshot = () => Promise.all(snapshotTables.map(async table => ({
      table, rows: (await pool.query("select * from " + table + " order by id")).rows,
    })));
    const before = await snapshot();
    const ownPath = id => "/careers?organizationId=" + id;
    let ownSuccesses = 0, malformedDenials = 0;
    for (const [index, employer] of employers.entries()) {
      const res = await fixture.standaloneRequest(ownPath(employer.id)); // anonymous by design
      assert.equal(res.status, 200, "own anonymous public Careers SSR must render");
      assert.ok(res.text.includes(employer.name), "SSR must identify only the selected employer");
      if (index === 2) {
        assert.ok(res.text.includes(victimPublic[0].title),
          "real published higher-ID victim listing must be visible when explicitly selected");
      } else {
        assert.ok(!res.text.includes(victimPublic[0].title),
          "unpublished attacker employer must not expose victim's published job");
      }
      for (const other of employers.filter(e => e.id !== employer.id)) {
        assert.ok(!res.text.includes(other.name), "cross-employer name in Careers SSR");
      }
      assert.ok(!res.text.includes("@example.invalid"), "private fictional worker email disclosed");
      // Shared public layout/navigation can mention "Payslips" or "Payroll".
      // Reject actual serialized private field names, not harmless menu text.
      // This covers quoted JSON and escaped React Flight object-property keys.
      assert.doesNotMatch(res.text,
        /\\*"(?:bankAccount|payslip|payrollRun|salaryAmount)\\*"\s*:/i,
        "Careers SSR may not serialize private worker/payroll fields");
      ownSuccesses++;
    }
    const invalid = [
      "/careers",
      "/careers?organizationId=",
      "/careers?organizationId=0",
      "/careers?organizationId=-1",
      "/careers?organizationId=+1",
      "/careers?organizationId=%201",
      "/careers?organizationId=1%20",
      "/careers?organizationId=01",
      "/careers?organizationId=1.0",
      "/careers?organizationId=1e0",
      "/careers?organizationId=9007199254740992",
      "/careers?organizationId=" + victim.id + "&organizationId=" + victim.id,
      "/careers?organizationId=" + employers[0].id + "&organizationId=" + victim.id,
      "/careers?organizationId=" + victim.id + "&organizationId=" + employers[0].id,
    ];
    for (const path of invalid) {
      const denied = await fixture.standaloneRequest(path);
      assert.equal(denied.status, 404, "invalid/ambiguous Careers selector must refuse: " + path);
      assert.ok(!denied.text.includes(victimPublic[0].title), "denial leaked the published victim job");
      for (const employer of employers) {
        assert.ok(!denied.text.includes(employer.name), "denial leaked an employer name");
      }
      malformedDenials++;
    }
    assert.equal(ownSuccesses, 3);
    assert.equal(malformedDenials, invalid.length);
    assert.deepEqual(await snapshot(), before,
      "public SSR/invalid selector requests may not change fictional employer, applicant or payroll SQL");
    console.log("PUBLIC_CAREERS_PAGE_SSR_ISOLATION " + JSON.stringify({
      fictionalEmployers: 3, ownPublishedReadSuccesses: ownSuccesses,
      realHigherIdVictimPublished: true, malformedAndDuplicateDenials: malformedDenials,
      victimOnlyPublishedJobs: true, databaseRowsUnchanged: true,
      productionCertified: false, pageActionCredits: 0,
      independentlyAccepted: false, moneyMoved: false, providerCalls: 0,
    }));
  } finally {
    await pool.end();
  }
}
run().catch(error => {
  console.error("PUBLIC_CAREERS_PAGE_SSR_REFUSED", String(error?.message ?? error));
  process.exitCode = 1;
});

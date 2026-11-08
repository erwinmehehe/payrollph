/**
 * Public Careers GET privacy/selectivity review ONLY. Zero tenant-method credits.
 *
 * Run after the original, byte-pinned EDG-01 --migrate and --prove workflow
 * against the same disposable fictional PG16 database. The original proves
 * three legitimate publication writes followed by two unpublishes, leaving
 * the higher-ID victim job public and attacker jobs unpublished.
 *
 * This file never mutates payroll, employer, applicant, public flags or SQL.
 */
import assert from "node:assert/strict";
import { requireDisposableCareersEnv } from "./tenant-edg01-careers-publication-contract.mjs";

async function run() {
  // Refuse remote, live-provider, non-CI or money-enabled contexts BEFORE DB import.
  requireDisposableCareersEnv();
  const [{ db, pool }, schema, orm, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  fixtures.requireTenantTableDisposable();
  const { asc } = orm;
  const { standaloneRequest } = fixtures;
  const version = await pool.query("show server_version_num");
  assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 16,
    "PUBLIC_CAREERS_REFUSED: PostgreSQL 16 required");
  try {
    const employers = await db.select({
      id: schema.organizations.id, name: schema.organizations.name,
    }).from(schema.organizations).orderBy(asc(schema.organizations.id));
    assert.equal(employers.length, 3, "must reuse exactly three original EDG-01 fictional employers");
    const expectedNames = ["TTBL-ATTA-", "TTBL-ATTB-", "TTBL-VICTIM-"];
    for (const [i, employer] of employers.entries()) {
      assert.ok(employer.name.startsWith(expectedNames[i]),
        "not the expected signed-in EDG-01 fixture employer");
    }
    const jobs = (await pool.query(
      "select id, organization_id, title, careers_published, status " +
      "from job_requisitions order by id"
    )).rows;
    const victim = employers[2];
    const publicVictim = jobs.filter(row =>
      row.organization_id === victim.id && row.careers_published === true);
    assert.equal(publicVictim.length, 1, "victim has a genuine published job");
    assert.equal(publicVictim[0].status, "open", "victim publication remains open");
    assert.ok(publicVictim[0].id > 6, "victim publication is the actual higher-ID requisition");
    for (const attacker of employers.slice(0, 2)) {
      assert.equal(jobs.filter(row =>
        row.organization_id === attacker.id && row.careers_published).length, 0,
        "attacker's independently published job was then unpublished by original proof");
    }

    // Hardcode table names. Only READ real fictional SQL state and assert no GET writes.
    const snapshotTables = [
      "organizations", "job_requisitions", "job_applicants",
      "audit_events", "payroll_runs", "employees",
    ];
    const snapshot = async () => Promise.all(snapshotTables.map(async table => ({
      table, rows: (await pool.query("select * from " + table + " order by id")).rows,
    })));
    const before = await snapshot();
    let returnedRealVictim = 0;
    for (const [i, employer] of employers.entries()) {
      // No cookie, token, private selector or cross-tenant authorization granted.
      const result = await standaloneRequest("/api/careers?organizationId=" + employer.id);
      assert.equal(result.status, 200, "anonymous public listing must succeed for " + i);
      assert.match(result.headers.get("cache-control") ?? "", /no-store/i);
      assert.equal(result.json?.organization, employer.name, "only requested employer is labeled");
      assert.ok(Array.isArray(result.json?.jobs), "public jobs must be an array");
      assert.deepEqual(result.json.jobs.map(job => job.id),
        i === 2 ? [publicVictim[0].id] : [],
        "public GET must not expose another employer, an unpublished or closed job");
      if (i === 2) {
        assert.equal(result.json.jobs[0].title, publicVictim[0].title);
        assert.deepEqual(Object.keys(result.json.jobs[0]).sort(),
          ["department", "description", "employmentType", "id", "title"].sort(),
          "the only allowed public job fields; no applicant, identity or pay data");
        returnedRealVictim++;
      }
      for (const other of employers.filter(item => item !== employer)) {
        assert.ok(!result.text.includes(other.name),
          "a public response must not mix another employer's identifying name");
      }
      assert.ok(!result.text.includes("@example.invalid"),
        "no fictional applicant or worker private email may appear in GET");
      assert.ok(!/"applicants"|"payroll"|"bankAccount"|"salary"/i.test(result.text),
        "public GET cannot carry private applicant or payroll structures");
    }
    assert.equal(returnedRealVictim, 1);
    assert.deepEqual(await snapshot(), before,
      "all anonymous GET calls must leave real employer, applicant, audit and payroll rows untouched");
    console.log("EDG01_PUBLIC_CAREERS_GET_REAL_HTTP " + JSON.stringify({
      fictionalEmployers: 3, higherIdVictimPublished: true,
      anonymousEmployerSelectedReads: 3,
      stillUnpublishedAttackersHidden: 2,
      publicFieldsOnly: true, privateApplicantDataExposed: false,
      databaseRowsUnchanged: true, productionCertified: false,
      coverageCredits: 0, publicByDesignReviewPending: true,
      moneyMoved: false, disposablePg16: true, providerCalls: 0,
    }));
  } finally {
    await pool.end();
  }
}
run().catch(error => {
  console.error("EDG01_PUBLIC_CAREERS_GET_REFUSED", String(error?.message ?? error));
  process.exitCode = 1;
});

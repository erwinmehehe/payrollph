/**
 * Exploratory three-employer HTML navigation probe over every business-ID page
 * in the full manifest. This is NOT page authorization certification: many
 * feature-disabled 403/404/redirects cannot serve as valid own-page positives.
 * Record the outstanding 18 GAPs and require proper browser/action adapters.
 * No production traffic or real accounts.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { employees, payrollRuns, userOrganizations, users } from "../../src/db/schema";
const manifest = JSON.parse(readFileSync(
  "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
function pageUrl(file, id) {
  const suffix = file.replace(/^src\/app/, "").replace(/\/page\.tsx$/, "");
  assert.ok(suffix.startsWith("/") && !suffix.includes("["),
    "Business-ID pages with dynamic segments need an explicit seeded adapter: " + file);
  return suffix + (suffix.includes("?") ? "&" : "?") + "organizationId=" + id;
}
export async function probeManifestBusinessPages(f, { request, makeSession, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).hostname, "127.0.0.1");
  const pages = manifest.scopedPages;
  assert.equal(pages.length, 21);
  const pageGaps = pages.filter((page) => page.status === "GAP");
  assert.equal(pageGaps.length, 18, "Manager inbox and the workspace have strict own/foreign HTTP proofs");
  const runSnapshot = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, f.orgs[0].id)).orderBy(payrollRuns.id);
  const employeeSnapshot = await db.select().from(employees)
    .where(eq(employees.organizationId, f.orgs[0].id)).orderBy(employees.id);

  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const linked = await db.insert(users).values([1, 2].map((idx) => ({
    email: "page-probe-employee-" + idx + "-" + nonce + "@example.invalid",
    name: "Fictional page employee " + idx, passwordHash: "fixture-only",
    role: "employee", employeeId: f.ownedEmployees[idx - 1].id,
  }))).returning({ id: users.id });
  await db.insert(userOrganizations).values(linked.map((u, i) => ({
    userId: u.id, organizationId: f.orgs[i + 1].id,
    role: "employee", active: true,
  })));
  const sessions = await Promise.all(linked.map((u) => makeSession(u.id)));

  const observations = [];
  for (const idx of [1, 2]) {
    const own = f.orgs[idx];
    const victim = f.orgs[0];
    const victimPrivateEmployeeMarker = f.victimEmployee.employeeNo;
    const victimOrgMarker = victim.name;
    assert.match(victimOrgMarker, /^Victim Only [0-9a-f]{12}$/,
      "Victim-exclusive employer marker MUST be present from a seeded DB row");
    assert.match(own.name, /^Attacker [AB] [0-9a-f]{12}$/,
      "Attacker must have a distinct populated employer name");
    assert.notEqual(victimOrgMarker, own.name, "Foreign and own employer markers must differ");
    assert.match(victimPrivateEmployeeMarker, /^V-[0-9a-f]{12}-7$/,
      "Victim-only employee identifier must come from a real seeded victim row");
    const ownerCookie = f.ownerSessions[idx].cookie;
    const employeeCookie = sessions[idx - 1].cookie;
    const signedIn = expectStatus(await request("/api/account", { cookie: ownerCookie }), 200,
      "Real owner browser-session account required for private page probes");
    assert.equal(signedIn.json?.profile?.id, f.owners[idx].id);
    for (const page of pages) {
      const path = page.path;
      const employeePage = path.startsWith("src/app/self/");
      const cookie = employeePage ? employeeCookie : ownerCookie;
      const ownRes = await request(pageUrl(path, own.id), { cookie });
      const foreignRes = await request(pageUrl(path, victim.id), { cookie });
      if (path === "src/app/app/page.tsx") {
        // A 200 error shell is not an authorized positive. Require the actual
        // persisted employer and worker in the server-rendered workspace.
        expectStatus(ownRes, 200, "Owned workspace SSR must load the verified snapshot");
        assert.match(ownRes.headers.get("content-type") ?? "", /text\/html/i);
        assert.ok(ownRes.text.includes(own.name), "Own persisted employer must render");
        assert.ok(ownRes.text.includes(f.ownedEmployees[idx - 1].employeeNo), "Own seeded worker must render");
        assert.ok(!ownRes.text.includes("Workspace unavailable"), "Unavailable cannot count as owned success");
        expectStatus(foreignRes, 404, "Foreign employer workspace must be denied before snapshot loading");
      }
      assert.ok(ownRes.status >= 200 && ownRes.status < 500,
        path + " own employer request returned server error HTTP " + ownRes.status);
      assert.ok(foreignRes.status >= 200 && foreignRes.status < 500,
        path + " foreign employer request returned server error HTTP " + foreignRes.status);
      assert.ok(!foreignRes.text.includes(victimPrivateEmployeeMarker),
        path + " directly rendered confidential victim-only employee ID");
      if (path !== "src/app/careers/page.tsx") {
        assert.ok(!foreignRes.text.includes("VictimExclusive7"),
          path + " rendered victim-only personnel details");
        if (foreignRes.text.includes(victimOrgMarker)) {
          // Fictional fixture only. Log bounded context to find which SSR/RSC
          // envelope exposed a foreign marker; DO NOT bypass this assertion.
          const offset = foreignRes.text.indexOf(victimOrgMarker);
          console.error("PAGE FOREIGN EMPLOYER MARKER (DISPOSABLE FIXTURE)", JSON.stringify({
            path, ownStatus: ownRes.status, foreignStatus: foreignRes.status,
            htmlBytes: foreignRes.text.length, markerOffset: offset,
            responseType: foreignRes.headers.get("content-type") ?? "",
            nearbyHtml: foreignRes.text.slice(Math.max(0, offset - 140),
              Math.min(foreignRes.text.length, offset + victimOrgMarker.length + 140))
              .replaceAll(victimOrgMarker, "[FICTIONAL VICTIM EMPLOYER]"),
          }));
        }
        assert.ok(!foreignRes.text.includes(victimOrgMarker),
          path + " rendered victim-exclusive employer name");
      }
      const authorizedPage200 = ownRes.status === 200 && /text\/html/i.test(
        ownRes.headers.get("content-type") ?? "");
      const correctlyDenied = [302, 303, 307, 308, 401, 403, 404].includes(foreignRes.status);
      observations.push({ file: path, attacker: idx, ownStatus: ownRes.status,
        foreignStatus: foreignRes.status, authorizedPage200, correctlyDenied,
        notCertified: !authorizedPage200 || !correctlyDenied });
      console.log("PAGE-GAP-PROBE " + path + " attacker-" + idx +
        " own=" + ownRes.status + " victim=" + foreignRes.status +
        " positive=" + authorizedPage200 + " denied=" + correctlyDenied);
    }
  }
  assert.equal(observations.length, 42);
  assert.deepEqual(await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, f.orgs[0].id)).orderBy(payrollRuns.id),
    runSnapshot, "Page navigation must not modify victim payroll");
  assert.deepEqual(await db.select().from(employees)
    .where(eq(employees.organizationId, f.orgs[0].id)).orderBy(employees.id),
    employeeSnapshot, "Page navigation must not modify victim employees");
  console.log(JSON.stringify({ kind: "EXPLORATORY_HTML_NOT_AUTHORIZATION_CERTIFICATION",
    allScopedPagePathsProbed: pages.length,
    independentAttackerCompanies: 2, httpPageComparisons: observations.length,
    authorizedOwn200AndForeignDenied: observations.filter((p) => !p.notCertified).length,
    outstandingPageOrActionGaps: pageGaps.length, pageGapsReclassified: 0,
    crossEmployerPIIMarkersObserved: 0, victimEmployeeAndPayrollUnchanged: true,
    requiresFeatureOnBrowserAndActionAcceptance: true,
    observedStatuses: observations }));
}

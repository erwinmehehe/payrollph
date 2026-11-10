import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, PAGE, SOURCE_PINS, requireDisposableMonitorEnv,
  verifyMonitorSource, gitBlobSha, assertOwnMonitorPage, assertDeniedMonitorPage,
} from "../scripts/qa/tenant-hcm-process-monitor-contract.mjs";

const runner = readFileSync("scripts/qa/tenant-hcm-process-monitor-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-hcm-process-monitor-ssr-qa.yml", "utf8");

const safeEnv = () => ({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_MONITOR_PAGE_PROOF: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  SECURITY_SMOKE_URL: ORIGIN, DEMO_MODE: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
  HCM_PROCESS_MONITOR_ENABLED: "true", HCM_PROCESS_MONITOR_ORG_IDS: "1,2,3",
  MULTI_ENTITY_ENABLED: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
});

test("HCM monitor proof refuses all non-disposable environments before any database import", () => {
  assert.equal(PAGE, "/hcm/process-monitor");
  assert.equal(requireDisposableMonitorEnv(safeEnv()), true);
  for (const [key, value] of [
    ["GITHUB_ACTIONS", "false"], ["CI", "false"], ["NODE_ENV", "development"],
    ["BUILD_BLOCK_ACCEPTANCE_MODE", "unknown"],
    ["DATABASE_URL", "postgresql://postgres:secret@db.production.invalid/data"],
    ["APP_BASE_URL", "https://app.example.invalid"],
    ["HCM_PROCESS_MONITOR_ENABLED", "false"],
    ["HCM_PROCESS_MONITOR_ORG_IDS", "1,2,3,4"],
    ["MULTI_ENTITY_ENABLED", "true"], ["WORKER_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "should-be-refused"],
    ["OPENAI_API_KEY", "should-be-refused"],
  ]) assert.throws(() => requireDisposableMonitorEnv({ ...safeEnv(), [key]: value }));
  assert.ok(runner.indexOf("requireDisposableMonitorEnv();") <
    runner.indexOf('import("../../src/db/index.ts")'), "Local-only refusal before DB import");
  assert.ok(runner.indexOf("verifyMonitorSource();") <
    runner.indexOf('import("../../src/db/index.ts")'), "Source pin refusal before DB import");
});

test("source-pinned HCM page authorization and real PG16 workflow", () => {
  assert.ok(Object.keys(SOURCE_PINS).length >= 5);
  for (const [path, sha] of Object.entries(SOURCE_PINS))
    assert.equal(gitBlobSha(readFileSync(path)), sha, "Unreviewed source drift " + path);
  assert.equal(verifyMonitorSource(), true);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /HCM_PROCESS_MONITOR_ENABLED: "true"/);
  assert.match(workflow, /HCM_PROCESS_MONITOR_ORG_IDS: "1,2,3"/);
  assert.match(workflow, /npm run db:push/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hcm-process-monitor-http\.mjs/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
});

test("real HTTP candidate actually tests populated own rows, higher-ID victim, hard denied selectors and SQL integrity", () => {
  for (const token of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "for (const actor of [a, b])", "sourceKey: subject.marker + \"-\" + suffix",
    "assertOwnMonitorPage(own, actor, subjects)",
    "assertOwnMonitorPage(list, actor, subjects",
    "pagePath(actor.org.id, other.process.id)",
    "pagePath(other.org.id, other.process.id)",
    "group_hr", "bookkeeper", "hr",
    "active: false", "assert.equal(accountAfterRevocation.status, 200",
    "await snapshot(subject.org.id), before.get(subject.org.id)",
    "ALTER TABLE hcm_business_process_instances RENAME TO qa_monitor_unavailable",
    "apiMethodCredits: 0, pageActionCredits: 0",
    "independentlyAccepted: false, productionCertified: false",
  ]) assert.ok(runner.includes(token), "Missing executable proof: " + token);
});

test("positive SSR proof cannot pass a blank page, reflected victim ID or empty timeline", () => {
  const headers = new Headers({ "content-type": "text/html" });
  const actor = { org: { id: 2, name: "Own employer" },
    process: { id: 4, sourceKey: "private-own" }, marker: "OWN-MARKER" };
  const victim = { org: { id: 8, name: "Victim employer" },
    process: { id: 12, sourceKey: "VICTIM-PRIVATE" }, marker: "VICTIM-MARKER" };
  const real = 'Business Process Monitor Recorded workflows Employer #<!-- -->2 ' +
    '<a href="?organizationId=2&amp;processId=4">Transfer</a> ' +
    'Step timeline <li>Step <!-- -->1 Approval</li>';
  assert.doesNotThrow(() => assertOwnMonitorPage({
    status: 200, headers, text: real,
  }, actor, [actor, victim]));
  for (const wrong of [
    "",
    real.replace("processId=4", "processId=12"),
    real.replace("Employer #<!-- -->2", "Employer #8"),
    real.replace("Step timeline", "Unknown timeline").replace("Step <!-- -->1", ""),
    real + victim.marker,
  ]) assert.throws(() => assertOwnMonitorPage({
    status: 200, headers, text: wrong,
  }, actor, [actor, victim]));
});

test("denied SSR cannot include a workflow shell or foreign process marker", () => {
  const headers = new Headers({ "content-type": "text/html" });
  const subject = { org: { id: 2, name: "Victim employer" },
    process: { id: 8, sourceKey: "private-key" }, marker: "PRIVATE-PROCESS" };
  assert.doesNotThrow(() => assertDeniedMonitorPage({
    status: 404, headers, text: "Not found",
  }, [subject], "safe 404"));
  // Next may reflect a denied request's own URL in router metadata; an
  // attacker-supplied numeric selector is not a private data disclosure.
  assert.doesNotThrow(() => assertDeniedMonitorPage({
    status: 404, headers, text: "Not found processId=8",
  }, [subject], "safe reflected selector"));
  for (const html of ["Business Process Monitor", "Recorded workflows",
    '<a href="/hcm/process-monitor?processId=8">Private workflow</a>',
    "private-key", subject.org.name, subject.marker]) {
    assert.throws(() => assertDeniedMonitorPage({
      status: 404, headers, text: "Not found " + html,
    }, [subject], "leaking 404"), "Must reject denied response with " + html);
  }
});

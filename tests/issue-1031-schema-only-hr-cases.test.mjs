import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseMigrationSql } from "../scripts/lib/issue-1031-sql-source-parser.mjs";

const path = "docs/sql/issue-1031-schema-only-hr-cases-review.sql";
const sql = readFileSync(path, "utf8");
const executable = sql.replace(/--[^\n]*/g, "");
const targets = ["employee_hr_cases", "employee_hr_case_messages"];
const bases = ["organizations", "users", "employees", "documents"];

test("#1031 HR cases proposal is unapproved, two-table and additive-only", () => {
  assert.match(sql, /REVIEW-ONLY CANDIDATE/);
  assert.match(sql, /NO-GO/);
  assert.match(executable, /^\s*BEGIN\s*;/);
  assert.match(executable, /COMMIT\s*;\s*$/);
  assert.equal((executable.match(/\bBEGIN\s*;/g) ?? []).length, 1);
  assert.equal((executable.match(/\bCOMMIT\s*;/g) ?? []).length, 1);
  assert.doesNotMatch(executable, /\b(?:ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|CONSTRAINT)|TRUNCATE|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|MERGE\s+INTO|GRANT|REVOKE|COPY|EXECUTE)\b/i);
  assert.doesNotMatch(executable, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i);
  const parsed = parseMigrationSql(executable);
  assert.deepEqual(parsed.creates, [...targets].sort());
  assert.deepEqual(parsed.hazards, []);
  assert.deepEqual(parsed.objects, [...targets].sort());
  for (const name of targets) assert.equal(
    (executable.match(new RegExp('CREATE TABLE "' + name + '"', "g")) ?? []).length, 1);
});

test("#1031 HR cases preflight fails closed on missing parent keys, bases, or existing target", () => {
  assert.match(executable, /DO \$issue1031_hr_guard\$/);
  assert.match(executable, /ISSUE1031_HR_BASE_DEPENDENCY_MISSING/);
  assert.match(executable, /ISSUE1031_HR_PARENT_TENANT_KEY_MISSING_OR_DRIFTED/);
  assert.match(executable, /ISSUE1031_HR_TARGET_ALREADY_PRESENT/);
  const guard = executable.split("END $issue1031_hr_guard$;")[0];
  for (const name of bases) assert.ok(guard.includes("to_regclass('public." + name + "') IS NULL"), name);
  for (const name of targets) assert.ok(guard.includes("to_regclass('public." + name + "') IS NOT NULL"), name);
  for (const unique of ["employees_org_id_workflows_unique", "documents_org_employee_id_hr_cases_unique"])
    assert.ok(guard.includes("conname = '" + unique + "'"), unique);
});

test("#1031 HR cases preserves composite tenant security and all dependent keys", () => {
  assert.match(executable, /CONSTRAINT "employee_hr_cases_employee_tenant_fk"[\s\S]*?FOREIGN KEY \("organization_id", "employee_id"\)[\s\S]*?REFERENCES "employees"\("organization_id", "id"\) ON DELETE cascade/);
  assert.match(executable, /CONSTRAINT "employee_hr_cases_coe_document_tenant_fk"[\s\S]*?FOREIGN KEY \("organization_id", "employee_id", "coe_document_id"\)[\s\S]*?REFERENCES "documents"\("organization_id", "employee_id", "id"\)/);
  assert.match(executable, /CONSTRAINT "employee_hr_case_messages_case_tenant_fk"[\s\S]*?FOREIGN KEY \("organization_id", "case_id"\)[\s\S]*?REFERENCES "employee_hr_cases"\("organization_id", "id"\) ON DELETE cascade/);
  assert.match(executable, /CONSTRAINT "employee_hr_cases_org_id_unique" UNIQUE \("organization_id", "id"\)/);
  assert.match(executable, /CONSTRAINT "employee_hr_cases_status_check"/);
  assert.match(executable, /CONSTRAINT "employee_hr_case_messages_visibility_check"/);
  const crosswalk = readFileSync("docs/engineering/issue-1031-source-table-crosswalk.csv", "utf8");
  for (const name of targets) assert.ok(crosswalk.includes('"' + name + '","","'), name);
});

test("#1019 HR owner-approved PG16/18 catalog-first CI keeps strict stable bootstrap and complete tests", () => {
  const wf = readFileSync(".github/workflows/issue-1031-schema-only-hr-cases-rehearsal.yml", "utf8");
  const policy = readFileSync("docs/engineering/issue-1019-schema-repair-acceptance-policy.md", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.devDependencies["drizzle-kit"], "0.31.11");
  assert.equal(pkg.dependencies["drizzle-orm"], "0.45.4");
  assert.equal(pkg.scripts["db:push"], "node scripts/strict-db-push.mjs");

  const catalogJob = wf.split("  disposable-postgres:\n")[1]?.split("  complete-npm-test:\n")[0];
  const fullTestJob = wf.split("  complete-npm-test:\n")[1];
  assert.ok(catalogJob && fullTestJob, "independent catalog and full-suite jobs must remain");
  assert.match(catalogJob, /postgres: \["16", "18"\]/);
  assert.match(catalogJob, /run: npm run db:push/);
  assert.match(catalogJob, /issue-1031-schema-only-hr-cases-postgres\.test\.ts/);
  assert.match(fullTestJob, /image: postgres:16/);
  assert.match(fullTestJob, /run: npm test/);
  assert.equal((wf.match(/run: npm run db:push/g) ?? []).length, 2,
    "one guarded first bootstrap per job; no additional repeat-push gate");
  assert.doesNotMatch(wf, /isolated-rc-repeat-proof:|drizzle-kit@1\.0\.0-rc\.\d+|SEPARATE_RC_TRUE_NO_OP=PASS/);
  assert.match(policy, /Second drizzle-kit push: not used as a gate, see #1019/);
  assert.match(policy, /Deliberately change one candidate column type/);
  assert.match(policy, /Reject full repeat application and partial-target application/);
  assert.match(policy, /23503/);
});

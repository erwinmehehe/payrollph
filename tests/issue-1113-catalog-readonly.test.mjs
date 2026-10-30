import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { assertIsolatedEnvironment, verifyIssue1113Catalog } from "../scripts/qa/issue-1113-catalog-readonly.mjs";

test("direct CLI invocation executes its refusal guard on native paths", () => {
  const result = spawnSync(process.execPath, ["scripts/qa/issue-1113-catalog-readonly.mjs"], {
    encoding: "utf8", env: { ...process.env, ISSUE1113_FICTIONAL_QA: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalog preflight blocked or failed/);
  assert.equal(result.stdout, "");
});

test("closure preflight refuses unconfirmed and production target environments", () => {
  assert.throws(() => assertIsolatedEnvironment({}), /CONFIRMATION_REQUIRED/);
  assert.throws(() => assertIsolatedEnvironment({
    ISSUE1113_FICTIONAL_QA: "I_CONFIRM_FICTIONAL_ISOLATED_DB", NODE_ENV: "production", DATABASE_URL: "dummy",
  }), /PRODUCTION_CONTEXT_REFUSED/);
  assert.throws(() => assertIsolatedEnvironment({
    ISSUE1113_FICTIONAL_QA: "I_CONFIRM_FICTIONAL_ISOLATED_DB", VERCEL_ENV: "production", DATABASE_URL: "dummy",
  }), /PRODUCTION_CONTEXT_REFUSED/);
  assert.doesNotThrow(() => assertIsolatedEnvironment({
    ISSUE1113_FICTIONAL_QA: "I_CONFIRM_FICTIONAL_ISOLATED_DB", DATABASE_URL: "dummy",
  }));
});

test("catalog preflight reports missing migration history without inventing signoff", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("current_database()")) return { rows: [{
        database_name: "fictional_qa", role_name: "qa_reader", readonly: "on",
      }] };
      if (sql.includes("information_schema.columns")) {
        const mk = (table_name, column_name) => ({
          table_name, column_name, udt_name: "numeric", character_maximum_length: null,
          is_nullable: "NO", column_default: "0",
        });
        const work = ["id","organization_id","employee_id","worksite_id","effective_from",
          "effective_until","reason","created_by","created_at"].map(n=>mk("employee_worksite_assignments",n));
        work.push({ ...mk("employee_worksite_assignments","decision"), udt_name:"varchar",
          character_maximum_length: 8, column_default: "'allow'::character varying" });
        const required = ["thirteenth_entitlement","thirteenth_paid_ytd","basic_salary_earned_ytd",
          "historical_basic_salary_earned","unpaid_basic_salary","separation_pay","retirement_pay",
          "other_benefits","final_statutory_deductions","gross_final_pay","final_pay_due_date",
          "computation_snapshot","approved_at","released_at","release_reference",
          "prepared_by_user_id","approved_by_user_id","released_by_user_id"];
        const legacy = Array.from({length:20},(_,i)=>mk("separation_records","legacy_"+i));
        return { rows:[...work,...legacy,...required.map(n=>mk("separation_records",n))] };
      }
      if (sql.includes("pg_catalog.pg_constraint")) return { rows: [{
        name:"separation_review_identity_separation_check",kind:"c",validated:true,
      }] };
      if (sql.includes("pg_catalog.to_regclass")) return { rows:[{present:false}] };
      return { rows:[] };
    },
  };
  const result = await verifyIssue1113Catalog(client);
  assert.equal(result.worksiteColumnCount,10);
  assert.equal(result.separationColumnCount,38);
  assert.equal(result.migrationJournalPresent,false);
  assert.equal(result.hostedOwnerHrUat,"NOT_RUN");
  assert.equal(result.actualDeploymentDatabaseIdentity,"UNVERIFIED");
  assert.match(queries[0],/READ ONLY/);
  assert.equal(queries.at(-1),"ROLLBACK");
  assert.ok(!queries.some(sql=>/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql)));
});

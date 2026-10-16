import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";

const ready = process.env.ISSUE1113_ACCEPTANCE_MODE === "isolated-ci-only";
const marker = "__NEW_ISOLATED_NEON_BRANCH_ID__";
const branch = "fictional-issue1113-disposable";
const project = "calm-wave-70219564";
const source = name => readFileSync(new URL("../docs/sql/" + name, import.meta.url), "utf8");
const gapRaw = source("issue1113-postcutover-schema-gapfill-REVIEW_ONLY.sql");
const expenseRaw = source("issue1113-expense-claim-actor-review-only.sql");
const authorize = sql => sql.replaceAll(marker, branch);
const gap = authorize(gapRaw), expense = authorize(expenseRaw);

test("review-only candidates: actual PG16/18 shape, identity and atomic rollback", {skip: !ready, timeout: 90000}, async t => {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  const url = "postgresql://postgres:postgres@127.0.0.1:5432/neondb";
  assert.equal(process.env.DATABASE_URL, url);
  for(const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED"]) assert.equal(process.env[key], "false");
  const db = new pg.Client({connectionString:url});
  await db.connect();
  try {
    const {rows:[pre]} = await db.query(`SELECT current_database() AS db,
      current_setting('server_version_num')::int AS version,
      (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')) AS objects`);
    assert.equal(pre.db,"neondb");
    assert.ok([16,18].includes(Math.floor(pre.version/10000)));
    assert.equal(pre.objects,0,"Refuse an existing database");
    await db.query("BEGIN");
    try {
      // All rows and schemas are fictional and rolled back. GUCs are test inputs,
      // not an attestation of any live Neon branch.
      await db.query(`CREATE TABLE public.organizations(id integer PRIMARY KEY);
        CREATE TABLE public.users(id integer PRIMARY KEY);
        CREATE TABLE public.separation_records(id integer PRIMARY KEY,organization_id integer,status varchar(20));
        CREATE TABLE public.employee_worksite_assignments(id integer PRIMARY KEY,effective_from date,effective_until date);
        CREATE TABLE public.workforce_schedule_guardrail_policies(id integer);
        CREATE TABLE public.workforce_attendance_lock_policies(id integer);
        CREATE TABLE public.workforce_attendance_period_locks(id integer);
        CREATE TABLE public.first_payroll_journey_progress(id integer);
        CREATE TABLE public.expense_claims(id integer PRIMARY KEY);
        INSERT INTO public.organizations VALUES(1); INSERT INTO public.users VALUES(1);
        INSERT INTO public.employee_worksite_assignments VALUES(1,'2026-10-01',NULL)`);
      await db.query(readFileSync(new URL("../drizzle/0102_final_pay_maker_checker.sql",import.meta.url),"utf8"));
      async function identity(projectId=project, branchId=branch) {
        await db.query("SELECT set_config('neon.project_id',$1,true),set_config('neon.branch_id',$2,true)",[projectId,branchId]);
      }
      async function sandbox(name, fn) {
        await t.test(name,async()=>{
          await db.query("SAVEPOINT candidate_case");
          try {await identity(); await fn();}
          finally {await db.query("ROLLBACK TO SAVEPOINT candidate_case");}
        });
      }
      const rejected = async (sql,pattern) => assert.rejects(()=>db.query(sql),error=>error.code==="P0001" && pattern.test(error.message));
      for(const sql of [gap,expense]) await t.test("unset Neon settings fail closed",async()=>{
        await db.query("SAVEPOINT unset_identity");
        try {await rejected(sql,/BRANCH|REHEARSAL/);}
        finally {await db.query("ROLLBACK TO SAVEPOINT unset_identity");}
      });
      for(const [label,sql] of [["gap",gap],["expense",expense]]) {
        for(const [name,p,b] of [["missing identity","",""],["wrong project","fictional-wrong",branch],
          ["production branch",project,"br-lucky-sound-b79i56jw"],["active QA",project,"br-green-hat-b77qj8fs"]]) {
          await sandbox(label+": "+name+" denied",async()=>{await identity(p,b);await rejected(sql,/BRANCH|REHEARSAL/);});
        }
      }
      for(const [label,sql] of [["gap",gapRaw],["expense",expenseRaw]]) {
        await sandbox(label+": unreplaced marker cannot be authorized by spoofing its GUC",async()=>{
          await identity(project,marker);await rejected(sql,/UNREVIEWED_BRANCH_PLACEHOLDER/);
        });
      }
      await sandbox("gap positive path preserves assignment and maker-checker",async()=>{
        await db.query(gap);
        const {rows:[row]}=await db.query("SELECT decision FROM public.employee_worksite_assignments WHERE id=1");
        assert.equal(row.decision,"allow");
        await assert.rejects(()=>db.query("INSERT INTO public.separation_records(id,prepared_by_user_id,approved_by_user_id) VALUES(2,1,1)"),e=>e.code==="23514");
      });
      for(const [name,ddl] of [
        ["similar but incorrect decision default","ALTER TABLE public.employee_worksite_assignments ADD decision varchar(8) NOT NULL DEFAULT 'disallow'"],
        ["missing numeric default","ALTER TABLE public.separation_records ADD gross_final_pay numeric(12,2) NOT NULL"],
        ["incorrect numeric default","ALTER TABLE public.separation_records ADD gross_final_pay numeric(12,2) NOT NULL DEFAULT 9"],
        ["incorrect due-date type","ALTER TABLE public.separation_records ADD final_pay_due_date text"],
        ["incorrect JSON default","ALTER TABLE public.separation_records ADD computation_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb"],
        ["unexpected nullable-column default","ALTER TABLE public.separation_records ADD release_reference varchar(160) DEFAULT 'invented'"],
        ["actor type drift","ALTER TABLE public.separation_records ALTER prepared_by_user_id TYPE bigint"],
      ]) await sandbox(name+" rejected",async()=>{await db.query(ddl);await rejected(gap,/COLUMN_SHAPE_DRIFT/);});
      await sandbox("existing exit amounts are never invented",async()=>{
        await db.query("INSERT INTO public.separation_records(id) VALUES(1)");
        await rejected(gap,/AMOUNT_RECONCILIATION/);
      });
      await sandbox("invalid historical worksite window rejected",async()=>{
        await db.query("UPDATE public.employee_worksite_assignments SET effective_until='2026-09-30'");
        await rejected(gap,/WORKSITE_WINDOW_INVALID/);
      });
      await sandbox("expense positive path and replay refusal",async()=>{
        await db.query(expense);
        const {rows:[fk]}=await db.query("SELECT confdeltype,convalidated FROM pg_constraint WHERE conrelid='public.expense_claims'::regclass AND contype='f'");
        assert.deepEqual(fk,{confdeltype:"n",convalidated:true});
        await rejected(expense,/COLUMN_EXISTS_REVIEW_DRIFT/);
      });
      await sandbox("existing expense submitters need explicit attribution",async()=>{
        await db.query("INSERT INTO public.expense_claims VALUES(1)");await rejected(expense,/BACKFILL_REVIEW/);
      });
      const post = expense.slice(expense.indexOf("DO $post$"));
      for(const [name,change] of [
        ["lookalike parent","CREATE TABLE public.users_archive(id integer PRIMARY KEY); ALTER TABLE public.expense_claims ADD FOREIGN KEY(submitted_by_user_id) REFERENCES public.users_archive(id) ON DELETE SET NULL"],
        ["wrong delete action","ALTER TABLE public.expense_claims ADD FOREIGN KEY(submitted_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE"],
        ["unvalidated FK","ALTER TABLE public.expense_claims ADD FOREIGN KEY(submitted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID"],
      ]) await sandbox("expense "+name+" rejected",async()=>{
        await db.query(expense);
        await db.query("ALTER TABLE public.expense_claims DROP CONSTRAINT expense_claims_submitted_by_user_id_fkey");
        await db.query(change);await rejected(post,/FOREIGN_KEY_DRIFT/);
      });
      assert.equal((await db.query("SELECT count(*)::int AS n FROM public.employee_worksite_assignments")).rows[0].n,1);
    } finally {await db.query("ROLLBACK");}
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_catalog.pg_tables WHERE schemaname='public'")).rows[0].n,0);
  } finally {await db.end();}
});

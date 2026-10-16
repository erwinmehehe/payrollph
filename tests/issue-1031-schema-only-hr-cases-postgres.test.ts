import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client } from "pg";
import { generateSchemaManifest } from "../scripts/lib/issue-1031-schema-manifest";
import { fullSchemaCatalogSql } from "../scripts/check-issue-1031-full-schema-diff";
import { diffSchema, type CatalogRow } from "../src/lib/issue-1031-full-schema-diff";

// Disposable GitHub CI ONLY. Does not execute on Neon, any real database,
// local developer databases, or a production environment.
const mode = process.env.ISSUE_1031_HR_REHEARSAL === "isolated-ci-only"
  && process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true";
const names = ["employee_hr_cases", "employee_hr_case_messages"];
const reverse = ["employee_hr_case_messages", "employee_hr_cases"];
const target = new Set(names);
const sql = readFileSync("docs/sql/issue-1031-schema-only-hr-cases-review.sql", "utf8");

test("#1031 HR source AST: only messages depend on cases, both depend only on present base tables", () => {
  const all = generateSchemaManifest().tables;
  const selected = all.filter(t => target.has(t.name));
  assert.equal(selected.length, 2);
  const prereqs = new Map(selected.map(t => [t.name, [...new Set(t.foreignKeys.map(f => f.refTable))]]));
  for (const [name, deps] of prereqs) for (const dep of deps)
    assert.ok(["organizations", "employees", "users", "documents", ...names].includes(dep),
      name + " depends on a missing numbered-source table: " + dep);
  assert.ok(prereqs.get("employee_hr_case_messages")?.includes("employee_hr_cases"));
  assert.ok(!prereqs.get("employee_hr_cases")?.includes("employee_hr_case_messages"));
  const incoming = all.filter(t => !target.has(t.name))
    .flatMap(t => t.foreignKeys.filter(f => target.has(f.refTable)).map(f => t.name + "." + f.name));
  assert.deepEqual(incoming, [], "cannot DROP a target with unforeseen external FK dependents");
});

test("#1031 HR: strict schema equivalence, guards and transactional tenant boundary on disposable PG", {
  skip: !mode, timeout: 180000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol)
    && ["127.0.0.1", "localhost"].includes(url.hostname)
    && url.port === "5432" && url.pathname === "/app_db"
    && url.username === "postgres" && !url.search && !url.hash,
  "ISSUE1031_HR_DISPOSABLE_POSTGRES_ONLY");
  const manifest = generateSchemaManifest();
  const subset = { ...manifest, tables: manifest.tables.filter(t => target.has(t.name)) };
  assert.equal(subset.tables.length, 2);
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000,
    query_timeout: 150000 });
  await client.connect();
  try {
    const snapshot = async (): Promise<CatalogRow[]> => {
      const rows = (await client.query<{
        table_name:string; kind:string; object_name:string; details:Record<string,unknown>
      }>(fullSchemaCatalogSql)).rows;
      return rows.filter(r => target.has(r.table_name)).map(r =>
        ({ table_name:r.table_name, kind:r.kind, object_name:r.object_name, ...r.details }) as CatalogRow);
    };
    const dropTargets = async () => {
      for (const name of reverse) await client.query('DROP TABLE IF EXISTS public."' + name + '"');
      assert.equal((await client.query(
        "SELECT count(*)::integer AS n FROM pg_catalog.pg_class c " +
        "JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace " +
        "WHERE ns.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[])", [names]
      )).rows[0].n, 0);
    };
    const before = await snapshot();
    assert.ok(before.length > 25, "Drizzle full source bootstrap must create both HR tables");
    await dropTargets();

    const badParent = sql.replace("conname = 'documents_org_employee_id_hr_cases_unique'",
      "conname = 'issue1031_hr_missing_tenant_unique'");
    assert.notEqual(badParent, sql);
    await assert.rejects(() => client.query(badParent), (e:unknown) =>
      (e as {code?:string;message?:string}).code==="P0001" &&
      (e as {message?:string}).message?.includes("ISSUE1031_HR_PARENT_TENANT_KEY_MISSING_OR_DRIFTED")===true);
    await client.query("ROLLBACK");
    assert.deepEqual(await snapshot(), [], "missing tenant parent key must fail before DDL");
    console.log("HR_PARENT_TENANT_UNIQUE_GUARD=PASS");

    const badBase = sql.replace("to_regclass('public.documents') IS NULL",
      "to_regclass('public.issue1031_hr_nonexistent') IS NULL");
    assert.notEqual(badBase, sql);
    await assert.rejects(() => client.query(badBase), (e:unknown) =>
      (e as {code?:string;message?:string}).code==="P0001" &&
      (e as {message?:string}).message?.includes("ISSUE1031_HR_BASE_DEPENDENCY_MISSING")===true);
    await client.query("ROLLBACK");
    assert.deepEqual(await snapshot(), [], "absent base must not create any target");
    console.log("HR_MISSING_BASE_GUARD=PASS");

    const wrong = sql.replace('"subject" varchar(160)', '"subject" varchar(161)');
    assert.notEqual(wrong, sql, "type mutation must change candidate source");
    await client.query(wrong);
    const drift = diffSchema(subset, await snapshot());
    assert.equal(drift.find(r => r.table==="employee_hr_cases" &&
      r.kind==="column" && r.object==="subject")?.status, "DRIFT");
    console.log("HR_WRONG_COLUMN_TYPE_DETECTED=PASS");

    await client.query('DROP TABLE public."employee_hr_case_messages"');
    await assert.rejects(() => client.query(sql), (e:unknown) =>
      (e as {code?:string;message?:string}).code==="P0001" &&
      (e as {message?:string}).message?.includes("ISSUE1031_HR_TARGET_ALREADY_PRESENT")===true);
    await client.query("ROLLBACK");
    assert.ok((await client.query("SELECT to_regclass('public.employee_hr_cases') IS NOT NULL AS exists")).rows[0].exists);
    console.log("HR_PARTIAL_TARGET_REJECTED=PASS");

    await client.query('DROP TABLE public."employee_hr_cases"');
    await client.query(sql);
    assert.deepEqual(await snapshot(), before,
      "HR columns, defaults, named FK actions, composite keys, indexes and checks must match stable Drizzle");
    assert.equal((await snapshot()).filter(r => r.kind==="table").length, 2);
    console.log("HR_EXACT_CATALOG_MATCH=PASS");

    await assert.rejects(() => client.query(sql), (e:unknown) =>
      (e as {code?:string;message?:string}).code==="P0001" &&
      (e as {message?:string}).message?.includes("ISSUE1031_HR_TARGET_ALREADY_PRESENT")===true);
    await client.query("ROLLBACK");
    assert.deepEqual(await snapshot(), before, "second application must be atomic rejection");
    console.log("HR_SECOND_APPLICATION_REJECTED=PASS");

    // Fictional transactions remain entirely in the disposable database.
    // No seed rows persist. The real composite tenant FKs must reject both
    // cross-org COE attachment and cross-org HR case messages.
    await client.query("BEGIN");
    try {
      const orgSql = "INSERT INTO organizations (name, legal_name) VALUES ($1,$1) RETURNING id";
      const a = (await client.query(orgSql, ["Fictional HR Rehearsal A"])).rows[0].id;
      const b = (await client.query(orgSql, ["Fictional HR Rehearsal B"])).rows[0].id;
      const user = (await client.query(
        "INSERT INTO users(email,name,password_hash) VALUES ('hr-rehearsal@synthetic.invalid','Fictional HR Actor','synthetic-only') RETURNING id"
      )).rows[0].id;
      const empSql = "INSERT INTO employees " +
        "(organization_id,employee_no,first_name,last_name,title,avatar_initials,basic_rate,start_date) " +
        "VALUES ($1,$2,'Fictional','Employee','QA Role','FE',1200,DATE '2026-01-01') RETURNING id";
      const empA = (await client.query(empSql, [a,"HR-FA-001"])).rows[0].id;
      const empB = (await client.query(empSql, [b,"HR-FB-001"])).rows[0].id;
      const docSql = "INSERT INTO documents " +
        "(organization_id,employee_id,kind,file_name,mime_type,byte_size,sha256,uploaded_by,content) " +
        "VALUES ($1,$2,'coe','fictional.txt','text/plain',8,$3,'fictional-ci','fictional') RETURNING id";
      const docA = (await client.query(docSql, [a,empA,"a".repeat(64)])).rows[0].id;
      const docB = (await client.query(docSql, [b,empB,"b".repeat(64)])).rows[0].id;
      const caseSql = "INSERT INTO employee_hr_cases " +
        "(organization_id,employee_id,created_by_user_id,case_type,subject,description,assigned_role,sla_due_at,coe_document_id) " +
        "VALUES ($1,$2,$3,'coe','Fictional COE','CI rollback only','hr',NOW() + INTERVAL '1 day',$4) RETURNING id";
      const id = (await client.query(caseSql, [a,empA,user,docA])).rows[0].id;
      assert.ok(Number.isSafeInteger(id), "valid within-org case must be accepted");
      await client.query("SAVEPOINT mismatched_document");
      let docDenied = false;
      try { await client.query(caseSql, [a,empA,user,docB]); }
      catch(e) {
        await client.query("ROLLBACK TO SAVEPOINT mismatched_document");
        assert.equal((e as {code?:string}).code,"23503");
        assert.equal((e as {constraint?:string}).constraint,"employee_hr_cases_coe_document_tenant_fk");
        docDenied = true;
      }
      assert.equal(docDenied,true,"cross-organization COE association must fail");
      await client.query("SAVEPOINT mismatched_case");
      let caseDenied = false;
      try { await client.query(
        "INSERT INTO employee_hr_case_messages (organization_id,case_id,actor_user_id,visibility,body) " +
        "VALUES ($1,$2,$3,'internal','fictional')", [b,id,user]
      ); }
      catch(e) {
        await client.query("ROLLBACK TO SAVEPOINT mismatched_case");
        assert.equal((e as {code?:string}).code,"23503");
        assert.equal((e as {constraint?:string}).constraint,"employee_hr_case_messages_case_tenant_fk");
        caseDenied = true;
      }
      assert.equal(caseDenied,true,"cross-organization HR message association must fail");
      console.log("HR_COMPOSITE_FK_CROSS_TENANT_DENIAL=PASS");
    } finally {
      await client.query("ROLLBACK");
    }
    assert.deepEqual(await snapshot(),before,"fictional rollback must preserve schema");
    console.log("HR_NO_PERSISTENT_TEST_ROWS=PASS");
  } finally {
    await client.end();
  }
});

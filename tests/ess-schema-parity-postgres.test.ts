import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const ci = process.env.CI === "true" && Boolean(process.env.DATABASE_URL);

/**
 * Exercise the actual Drizzle-pushed development schema, not a mock table or
 * source-text grep. This test never commits and never connects to remote Neon.
 */
test("ESS 0105 database contract: two tenants, photo lifecycle, reviewed IDs and constraints", {
  skip: !ci, timeout: 40_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  const suffix = randomUUID().slice(0, 12);
  await client.query("BEGIN");
  try {
    const organizations = await client.query<{ id: number }>(
      "INSERT INTO organizations(name,legal_name) VALUES ($1,'Fictional QA'),($2,'Fictional QA') RETURNING id",
      ["ESS fixture A " + suffix, "ESS fixture B " + suffix],
    );
    assert.equal(organizations.rows.length, 2);
    const people: { org: number; emp: number; user: number }[] = [];
    for (const [i,organization] of organizations.rows.entries()) {
      const emp = await client.query<{ id: number }>(
        "INSERT INTO employees(organization_id,employee_no,first_name,last_name,title,avatar_initials,basic_rate,start_date) VALUES($1,$2,'Fictional','Person','QA','FP',30000,'2026-10-13') RETURNING id",
        [organization.id, "ESS-QA-" + i + "-" + suffix],
      );
      const user = await client.query<{ id: number }>(
        "INSERT INTO users(name,email,password_hash,role,employee_id) VALUES('Fictional QA',$1,'synthetic-test-only','employee',$2) RETURNING id",
        ["ess-qa-" + i + "-" + suffix + "@example.invalid", emp.rows[0].id],
      );
      people.push({ org: organization.id, emp: emp.rows[0].id, user: user.rows[0].id });
    }
    const [a,b] = people;
    for (const person of people) {
      await client.query(
        "INSERT INTO ess_identifier_requests(organization_id,employee_id,kind,proposed_encrypted,requested_by_user_id) VALUES ($1,$2,'tin','enc:govid:v1:fictional',$3)",
        [person.org, person.emp, person.user],
      );
    }
    // The 0105 partial unique index must also exist in the Drizzle schema.
    await client.query("SAVEPOINT duplicate");
    await assert.rejects(
      client.query(
        "INSERT INTO ess_identifier_requests(organization_id,employee_id,kind,proposed_encrypted,requested_by_user_id) VALUES($1,$2,'tin','enc:govid:v1:fictional',$3)",
        [a.org,a.emp,a.user],
      ),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23505"),
    );
    await client.query("ROLLBACK TO SAVEPOINT duplicate");

    await client.query("SAVEPOINT status");
    await assert.rejects(
      client.query("UPDATE ess_identifier_requests SET status='invalid' WHERE employee_id=$1", [a.emp]),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"),
    );
    await client.query("ROLLBACK TO SAVEPOINT status");

    await client.query("UPDATE ess_identifier_requests SET status='approved',reviewed_at=now() WHERE employee_id=$1", [a.emp]);
    await client.query(
      "INSERT INTO ess_identifier_requests(organization_id,employee_id,kind,proposed_encrypted,requested_by_user_id) VALUES($1,$2,'tin','enc:govid:v1:fictional',$3)",
      [a.org,a.emp,a.user],
    );
    const requestCounts=await client.query<{ organization_id:number; pending:string }>(
      "SELECT organization_id, count(*) FILTER(WHERE status='pending')::text AS pending FROM ess_identifier_requests WHERE organization_id IN ($1,$2) GROUP BY organization_id ORDER BY organization_id",
      [a.org,b.org],
    );
    assert.equal(requestCounts.rows.length,2);
    assert.ok(requestCounts.rows.every(x=>x.pending==="1"));

    for (const person of people) {
      await client.query(
        "INSERT INTO ess_employee_photos(employee_id,organization_id,mime_type,byte_size,sealed_photo,content_sha256) VALUES($1,$2,'image/png',32,'enc:essphoto:v1:fictional',$3)",
        [person.emp,person.org,"0".repeat(64)],
      );
    }
    await client.query("SAVEPOINT mime");
    await assert.rejects(
      client.query("UPDATE ess_employee_photos SET mime_type='text/plain' WHERE employee_id=$1", [a.emp]),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"),
    );
    await client.query("ROLLBACK TO SAVEPOINT mime");
    await client.query("SAVEPOINT size");
    await assert.rejects(
      client.query("UPDATE ess_employee_photos SET byte_size=524289 WHERE employee_id=$1", [a.emp]),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"),
    );
    await client.query("ROLLBACK TO SAVEPOINT size");
    await client.query("DELETE FROM ess_employee_photos WHERE employee_id=$1 AND organization_id=$2", [a.emp,a.org]);
    const photos=await client.query<{ organization_id:number }>(
      "SELECT organization_id FROM ess_employee_photos WHERE organization_id IN ($1,$2)", [a.org,b.org],
    );
    assert.deepEqual(photos.rows.map(x=>x.organization_id),[b.org]);

    for (const person of people) {
      await client.query(
        "INSERT INTO ess_other_identifiers(organization_id,employee_id,kind,encrypted_value) VALUES($1,$2,'passportNo','enc:govid:v1:fictional')",
        [person.org,person.emp],
      );
    }
    await client.query("SAVEPOINT other_unique");
    await assert.rejects(
      client.query(
        "INSERT INTO ess_other_identifiers(organization_id,employee_id,kind,encrypted_value) VALUES($1,$2,'passportNo','enc:govid:v1:fictional')",
        [a.org,a.emp],
      ),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23505"),
    );
    await client.query("ROLLBACK TO SAVEPOINT other_unique");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});
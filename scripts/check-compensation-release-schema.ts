import { pool } from "../src/db";
import {
  inspectCompensationOutboxSchema,
  validateCompensationOutboxSchema,
} from "../src/lib/compensation-release-schema";

/**
 * Catalog-only release schema preflight. With a read-only DB login and a
 * repeatable-read, READ ONLY transaction this cannot change employer payroll
 * or fabricate an operational acceptance certificate.
 */
async function main() {
  let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    const snapshot = await inspectCompensationOutboxSchema(client, "public");
    const result = validateCompensationOutboxSchema(snapshot);
    await client.query("COMMIT");
    console.log(JSON.stringify({
      targetSchema: "public",
      outboxSchemaCompatible: result.schemaCompatible,
      issueCodes: result.issues,
      readOnly: true,
      technicalEvidenceOnly: true,
      payrollGAApproved: false,
      migrationAppliedByCheck: false,
      independentlyReviewed: false,
    }, null, 2));
    process.exitCode = result.schemaCompatible ? 0 : 1;
  } catch {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* connection may already be gone */ }
    }
    // Never log connection details or sensitive PostgreSQL exception text.
    console.error("Compensation schema preflight could not complete; confirm approved database access and version.");
    process.exitCode = 2;
  } finally {
    client?.release();
    await pool.end();
  }
}

void main();

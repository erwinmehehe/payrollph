import { pool } from "../src/db";
import { ensureMarketingLeadSchema } from "../src/lib/marketing-leads";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const statusArg = process.argv.find((arg) => arg.startsWith("--status="));
const limit = Math.max(1, Math.min(Number(limitArg?.split("=")[1] ?? 50) || 50, 200));
const status = statusArg?.split("=")[1]?.trim() || "new";

await ensureMarketingLeadSchema();

const result = await pool.query<{
  id: number;
  kind: string;
  name: string;
  email: string;
  company: string;
  headcount: string | null;
  payroll_frequency: string | null;
  entities: string | null;
  status: string;
  notification_status: string;
  created_at: Date;
}>(
  `SELECT id, kind, name, email, company, headcount, payroll_frequency, entities,
          status, notification_status, created_at
   FROM marketing_leads
   WHERE ($1 = 'all' OR status = $1)
   ORDER BY created_at DESC
   LIMIT $2`,
  [status, limit],
);

if (result.rows.length === 0) {
  console.log(`No marketing leads found for status "${status}".`);
} else {
  console.table(result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    kind: row.kind,
    company: row.company,
    name: row.name,
    email: row.email,
    headcount: row.headcount ?? "",
    payrollFrequency: row.payroll_frequency ?? "",
    entities: row.entities ?? "",
    status: row.status,
    notification: row.notification_status,
  })));
}

await pool.end();

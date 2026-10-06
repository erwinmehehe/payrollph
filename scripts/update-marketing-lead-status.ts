import { pool } from "../src/db";
import { ensureMarketingLeadSchema } from "../src/lib/marketing-leads";

const idArg = process.argv.find((arg) => arg.startsWith("--id="));
const statusArg = process.argv.find((arg) => arg.startsWith("--status="));
const id = Number(idArg?.split("=")[1]);
const status = statusArg?.split("=")[1]?.trim() ?? "";
const allowed = new Set(["new", "contacted", "qualified", "closed"]);

if (!Number.isInteger(id) || id <= 0) {
  throw new Error("Pass a valid lead id, for example --id=42.");
}
if (!allowed.has(status)) {
  throw new Error("Pass --status=new|contacted|qualified|closed.");
}

await ensureMarketingLeadSchema();

const result = await pool.query<{
  id: number;
  kind: string;
  company: string;
  email: string;
  status: string;
  updated_at: Date;
}>(
  `UPDATE marketing_leads
   SET status = $2,
       updated_at = NOW()
   WHERE id = $1
   RETURNING id, kind, company, email, status, updated_at`,
  [id, status],
);

const lead = result.rows[0];
if (!lead) {
  throw new Error(`Marketing lead #${id} was not found.`);
}

console.table([{
  id: lead.id,
  kind: lead.kind,
  company: lead.company,
  email: lead.email,
  status: lead.status,
  updatedAt: lead.updated_at.toISOString(),
}]);

await pool.end();

import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { parseCsv } from "@/lib/csv-import";
import { toCsv } from "@/lib/csv";
import { getSessionUser } from "@/lib/auth";
import { TEMPLATE_CSV } from "@/app/api/employees/import/route";

export const dynamic = "force-dynamic";

/**
 * Serves the import template as real CSV. The main import route returns JSON,
 * so the UI cannot use it as a download target without producing a JSON file
 * masquerading as .csv.
 */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const rows = parseCsv(TEMPLATE_CSV);
  const template = criticalReleaseFlagEnabled("employeeImportPreview")
    ? toCsv({ columns: [...rows[0], "TIN", "Department"], rows: rows.slice(1).map(row => [...row, "", ""]) })
    : TEMPLATE_CSV;
  return new Response(template, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="linaw-employee-template.csv"',
    },
  });
}

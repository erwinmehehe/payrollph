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

  return new Response(TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="linaw-employee-template.csv"',
    },
  });
}

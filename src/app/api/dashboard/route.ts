import { getDashboardData } from "@/lib/dashboard-data";
import { assertMembership } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId"));
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertMembership(user.id, organizationId);
  if (deniedOrg) return deniedOrg;
  const data = await getDashboardData(Number.isFinite(organizationId) && organizationId > 0 ? organizationId : undefined);
  return Response.json(data);
}

import { getSessionUser } from "@/lib/auth";
import { buildCapabilityReport } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!["owner", "admin", "bookkeeper"].includes(user.role)) {
    return Response.json({ error: "Only workspace administrators can view deployment capability diagnostics." }, { status: 403 });
  }
  return Response.json(await buildCapabilityReport());
}

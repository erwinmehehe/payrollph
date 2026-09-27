import { getSessionUser, publicUser } from "@/lib/auth";
import { ensureSeedData } from "@/db/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeedData();
  const user = await getSessionUser();
  if (!user) return Response.json({ user: null });
  return Response.json({ user: publicUser(user) });
}

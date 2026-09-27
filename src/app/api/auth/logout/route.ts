import { cookies } from "next/headers";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", expires: new Date(0) });
  return Response.json({ ok: true });
}

import { enforceSameOriginMutation } from "@/lib/security-request";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { revokePresentedSessionOnce } from "@/lib/revoke-presented-session";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokePresentedSessionOnce(token);
  jar.set(SESSION_COOKIE, "", sessionCookieOptions(new Date(0)));
  return Response.json({ ok: true });
}

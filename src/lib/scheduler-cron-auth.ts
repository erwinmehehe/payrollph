import { constantTimeSecretEqual } from "@/lib/security-secret";

export type CronAuthorization = "authorized" | "unauthorized" | "misconfigured";

/**
 * Cron authentication is independent of the worker token, status monitor and
 * browser session. Vercel sends CRON_SECRET as an Authorization bearer token.
 */
export function cronAuthorization(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): CronAuthorization {
  const secret = env.CRON_SECRET;
  if (!secret || secret !== secret.trim() || /[\r\n]/.test(secret) || Buffer.byteLength(secret, "utf8") < 32) {
    return "misconfigured";
  }
  return constantTimeSecretEqual(request.headers.get("authorization"), `Bearer ${secret}`)
    ? "authorized"
    : "unauthorized";
}

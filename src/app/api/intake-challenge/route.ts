import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { issueIntakeProof } from "@/lib/public-intake-proof";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { normalizeEmail, validEmail } from "@/lib/validation";
import { sha256 } from "@/lib/crypto";

export async function POST(request: Request) {
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  if (!criticalReleaseFlagEnabled("publicIntakeProof")) return Response.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  const ipLimit = await rateLimitDistributed("intake-challenge:" + clientIp(request), { limit: 20, windowMs: 300_000 });
  if (ipLimit.mode !== "distributed-postgres") return Response.json({ error: "Security check is unavailable." }, { status: 503 });
  if (!ipLimit.allowed) return Response.json({ error: "Please wait before retrying." }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return Response.json({ error: "Enter a valid email." }, { status: 422 });
  const emailLimit = await rateLimitDistributed("intake-challenge-email:" + sha256(email), { limit: 20, windowMs: 300_000 });
  if (emailLimit.mode !== "distributed-postgres") return Response.json({ error: "Security check is unavailable." }, { status: 503 });
  if (!emailLimit.allowed) return Response.json({ error: "Please wait before retrying." }, { status: 429 });
  try {
    return Response.json({ enabled: true, ...issueIntakeProof(email, process.env) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Security check is unavailable." }, { status: 503 });
  }
}

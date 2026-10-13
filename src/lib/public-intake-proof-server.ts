import { consumeIntakeProof } from "./public-intake-proof";
import { rateLimitDistributed } from "./rate-limit";

export async function enforceIntakeProof(body: Record<string, unknown>, email: string) {
  try {
    const result = await consumeIntakeProof({ proof: body.intakeProof, email, env: process.env,
      claim: tokenHash => rateLimitDistributed("intake-proof:" + tokenHash, { limit: 1, windowMs: 300_000 }) });
    if (result === "unavailable") return Response.json({ error: "Security check is temporarily unavailable." }, { status: 503 });
    if (result === "invalid" || result === "replayed") return Response.json({ error: "Please retry the security check.", problems: ["The security check expired or was already used. Please submit again."] }, { status: 422 });
    return null;
  } catch {
    return Response.json({ error: "Security check is temporarily unavailable." }, { status: 503 });
  }
}

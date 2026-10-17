export async function obtainIntakeProof(email: string) {
  // The server is the authority for the challenge gate. Build-time public flags
  // can be stale across deployments and must never silently skip a required proof.
  const response = await fetch("/api/intake-challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  const challenge = await response.json();
  if (!response.ok) throw Error(challenge.error ?? "Security check unavailable. Please retry.");
  if (challenge.enabled === false) return undefined;
  if (challenge.difficulty !== 16 || typeof challenge.token !== "string" || challenge.token.length > 1024) throw Error("Invalid security check.");
  const encoder = new TextEncoder();
  const started = Date.now();
  for (let nonce = 0; nonce <= 0xffffffff; nonce++) {
    if (Date.now() - started > 30_000) throw Error("Security check timed out. Please retry.");
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(challenge.token + ":" + nonce)));
    if (hash[0] === 0 && hash[1] === 0) return { token: challenge.token, nonce };
    if (nonce % 256 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw Error("Security check failed. Please retry.");
}

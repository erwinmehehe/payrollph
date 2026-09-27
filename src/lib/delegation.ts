import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { approvalDelegations } from "@/db/schema";

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Resolves who may actually decide an approval right now.
 * Returns the original approver plus any active delegate chain (max depth 3 to avoid cycles).
 */
export async function resolveEffectiveApprovers(organizationId: number, approver: string, onDate = today()) {
  const delegations = await db.select().from(approvalDelegations).where(and(
    eq(approvalDelegations.organizationId, organizationId),
    eq(approvalDelegations.active, true),
    lte(approvalDelegations.startsOn, onDate),
    gte(approvalDelegations.endsOn, onDate),
  ));

  const chain: Array<{ from: string; to: string; reason: string }> = [];
  const seen = new Set([approver.toLowerCase()]);
  let current = approver;

  for (let depth = 0; depth < 3; depth += 1) {
    const match = delegations.find((row) => row.fromApprover.toLowerCase() === current.toLowerCase());
    if (!match) break;
    if (seen.has(match.toApprover.toLowerCase())) break;
    chain.push({ from: match.fromApprover, to: match.toApprover, reason: match.reason });
    seen.add(match.toApprover.toLowerCase());
    current = match.toApprover;
  }

  return {
    originalApprover: approver,
    effectiveApprover: current,
    delegated: chain.length > 0,
    chain,
    allowed: Array.from(seen),
  };
}

export async function canDecide(organizationId: number, approver: string, actor: string) {
  const resolved = await resolveEffectiveApprovers(organizationId, approver);
  return {
    ...resolved,
    permitted: resolved.allowed.includes(actor.toLowerCase()),
  };
}

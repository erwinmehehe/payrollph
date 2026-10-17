import { sql } from "drizzle-orm";
import { db } from "@/db";
import { executeAuditRoleProof } from "./audit-role-proof";
export { AUDIT_CHAIN_PROOF_KEYS, auditChainProtectionProven } from "./audit-role-proof";

// Metadata-only pilot blocker; no schema repair and no manual bypass.
export async function auditChainRuntimeProtectionReady(): Promise<boolean> {
  return executeAuditRoleProof(query => db.execute(sql.raw(query)));
}

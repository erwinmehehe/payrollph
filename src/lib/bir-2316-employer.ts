/** Resolve the employer frozen at final-pay preparation, never today's worker assignment. */
type Employer = { id: number; organizationId: number; legalName: string; birTin: string | null; birBranchCode: string | null };
/** The approved final-pay fingerprint, never today's employee assignment, binds tax identity. */
export function frozenFinalPayLegalEntityId(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const fingerprint = (snapshot as { sourceFingerprint?: unknown }).sourceFingerprint;
  if (!fingerprint || typeof fingerprint !== "object" || Array.isArray(fingerprint)) return null;
  const id = (fingerprint as { employeeLegalEntityId?: unknown }).employeeLegalEntityId;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function historical2316Employer(input: {
  organizationId: number; snapshot: unknown; entities: Employer[];
  legacy: { legalName: string | null; name: string; birTin: string | null; birBranchCode: string | null };
}) {
  const fail = () => ({ ok: false as const, code: "HISTORICAL_EMPLOYER_UNVERIFIED" });
  const snapshot = input.snapshot as { sourceFingerprint?: { employeeLegalEntityId?: unknown } } | null;
  const fingerprint = snapshot?.sourceFingerprint;
  if (!fingerprint || !Object.hasOwn(fingerprint, "employeeLegalEntityId")) return fail();
  const id = fingerprint.employeeLegalEntityId;
  // A null frozen ID is legacy single-employer evidence only if no legal-entity
  // records exist. A missing or deleted explicit entity never inherits org TIN.
  const entity = typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? input.entities.find(e => e.id === id && e.organizationId === input.organizationId) : null;
  if (!entity && !(id === null && input.entities.length === 0)) return fail();
  const source = entity ?? input.legacy;
  const name = source.legalName || (!entity ? input.legacy.name : "");
  const tin = (source.birTin ?? "").replace(/\D/g, "");
  const branch = source.birBranchCode ?? "";
  if (!name.trim() || !/^\d{9}$/.test(tin) || !/^\d{4}$/.test(branch)) return fail();
  return { ok: true as const, name, tin: `${tin}-${branch}`, legalEntityId: entity?.id ?? null };
}

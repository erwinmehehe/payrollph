/**
 * Presentation-only treasury authorization projection for payroll exports.
 *
 * The API must still authorize every payout/export action. An unobserved,
 * malformed, or wrong-employer permission read must not enable UI actions.
 */
export type TreasuryExportStatus = Readonly<{
  enabled: boolean;
  assigned: boolean;
}>;

export type ScopedTreasuryExportStatus = Readonly<{
  scope: string;
  status: TreasuryExportStatus;
}>;

export function treasuryExportScope(input: {
  organizationId: number;
  userId: number | null;
  role: string | null;
  companyWide: boolean;
}): string {
  return JSON.stringify([
    input.organizationId,
    input.userId,
    input.role,
    input.companyWide,
  ]);
}

export function parseTreasuryExportStatus(payload: unknown): TreasuryExportStatus | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (!record.policy || typeof record.policy !== "object" || Array.isArray(record.policy)) return null;
  const enabled = (record.policy as Record<string, unknown>).enabled;
  const assigned = record.currentUserAssigned;
  if (typeof enabled !== "boolean" || typeof assigned !== "boolean") return null;
  return { enabled, assigned };
}

export function visibleTreasuryExportStatus(
  scope: string,
  eligible: boolean,
  observed: ScopedTreasuryExportStatus | null,
): TreasuryExportStatus | null {
  // Ineligible roles never fetch treasury controls or inherit a previous role.
  if (!eligible) return { enabled: false, assigned: false };
  return observed?.scope === scope ? observed.status : null;
}

export function treasuryExportPermissions(
  role: string | null,
  status: TreasuryExportStatus | null,
): { canRecordManualPayout: boolean; canGenerateLiveBankFile: boolean } {
  // Loading, failed, and unverified responses deny controls; the backend is
  // independently authoritative even when the UI status has been confirmed.
  if (!status) return { canRecordManualPayout: false, canGenerateLiveBankFile: false };

  if (status.enabled) {
    return {
      canRecordManualPayout: status.assigned,
      canGenerateLiveBankFile: status.assigned,
    };
  }

  return {
    canRecordManualPayout: role === "owner",
    canGenerateLiveBankFile: ["owner", "admin", "bookkeeper", "payroll"].includes(role ?? ""),
  };
}

/**
 * Fail-closed evaluation of the audited bank-file PREVIEW for a no-money
 * payroll pilot. Never call a preview a transfer or bank acceptance.
 *
 * The metadata is read from an audited export event, not from the sign-off
 * request body. Legacy or incomplete events are intentionally insufficient.
 */
export type PilotBankExportEvent = {
  action: string;
  createdAt: Date;
  metadata: unknown;
};

function nonNegativeCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/.test(value)) return null;
  const [pesos, centavos] = value.split(".");
  const cents = Number(pesos) * 100 + Number(centavos);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Checks evidence, not the actual bank's receipt or ownership of the file. */
export function isValidPilotBankDryRunEvidence(
  event: PilotBankExportEvent,
  releasedAt: Date | null,
  expected: { employeeCount: number; netPay: number },
): boolean {
  if (event.action !== "Bank file dry-run generated" || !releasedAt) return false;
  const exportedAt = event.createdAt.getTime();
  const releaseTime = releasedAt.getTime();
  if (!Number.isFinite(exportedAt) || !Number.isFinite(releaseTime) || exportedAt < releaseTime) return false;
  if (!positiveInteger(expected.employeeCount) || !Number.isFinite(expected.netPay) || expected.netPay < 0) return false;
  const expectedCents = Math.round(expected.netPay * 100);
  if (!Number.isSafeInteger(expectedCents)) return false;

  if (!event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) return false;
  const meta = event.metadata as Record<string, unknown>;
  const digest = meta.bankExportSha256;
  if (meta.kind !== "bank" || meta.dryRun !== true
    || meta.bankExportSyntheticDemoDestinations !== false
    || typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)
    || meta.bankExportRowCount !== expected.employeeCount
    || meta.bankExportMissingDestinations !== 0
    || meta.bankExportMissingPaymentSnapshots !== 0
    || meta.bankExportMissingIdentitySnapshots !== 0
    || nonNegativeCents(meta.bankExportTotalNet) !== expectedCents) {
    return false;
  }

  const parts = meta.bankFileParts;
  if (!positiveInteger(meta.bankFileCount)
    || !Array.isArray(parts)
    || parts.length !== meta.bankFileCount) return false;

  let partRows = 0;
  let partCents = 0;
  for (const part of parts) {
    if (!part || typeof part !== "object" || Array.isArray(part)) return false;
    const data = part as Record<string, unknown>;
    const cents = nonNegativeCents(data.totalNet);
    if (typeof data.filename !== "string" || !data.filename
      || !positiveInteger(data.rowCount) || cents === null) return false;
    partRows += data.rowCount;
    partCents += cents;
    if (!Number.isSafeInteger(partRows) || !Number.isSafeInteger(partCents)) return false;
  }
  return partRows === expected.employeeCount && partCents === expectedCents;
}

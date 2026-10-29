export type PayrollDraftIntent = {
  organizationId: number; legalEntityId: number | null; scopeOrgUnitId: number | null;
  periodStart: string; periodEnd: string; payDate: string; processNow: boolean;
};

export function payrollDraftIntentFingerprint(input: PayrollDraftIntent): string {
  return JSON.stringify([input.organizationId, input.legalEntityId, input.scopeOrgUnitId,
    input.periodStart, input.periodEnd, input.payDate, input.processNow]);
}

export function validPayrollDraftKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value);
}

/** Event-handler only. Keep uncertain writes recoverable across component/page reloads. */
export function payrollDraftBrowserKey(
  storage: Pick<Storage, "getItem" | "setItem">, userId: number, input: PayrollDraftIntent,
  generate: () => string = () => crypto.randomUUID(),
): string {
  const slot = `linaw:payroll-draft-intent:v1:${input.organizationId}:${userId}`;
  const fingerprint = payrollDraftIntentFingerprint(input);
  const saved = storage.getItem(slot);
  if (saved !== null) {
    // Invalid stored state is not permission to silently start another write.
    let parsed: unknown;
    try { parsed = JSON.parse(saved); } catch { throw Error("Saved payroll attempt is unreadable. Open Payroll to check existing runs before retrying."); }
    if (!parsed || typeof parsed !== "object" || !("key" in parsed) || !validPayrollDraftKey(parsed.key)
      || !("fingerprint" in parsed) || typeof parsed.fingerprint !== "string") {
      throw Error("Saved payroll attempt is invalid. Open Payroll to check existing runs before retrying.");
    }
    if (parsed.fingerprint === fingerprint) return parsed.key;
  }
  const key = generate();
  if (!validPayrollDraftKey(key)) throw Error("Could not identify this payroll creation attempt.");
  storage.setItem(slot, JSON.stringify({ key, fingerprint }));
  return key;
}

/** Only after a verified success. A late response cannot erase a newer attempt. */
export function completePayrollDraftBrowserKey(storage: Pick<Storage,"getItem"|"removeItem">,
  userId: number, organizationId: number, key: string): void {
  const slot = `linaw:payroll-draft-intent:v1:${organizationId}:${userId}`;
  try {
    const saved = storage.getItem(slot);
    if (saved && JSON.parse(saved)?.key === key) storage.removeItem(slot);
  } catch { /* The committed write remains successful; retaining its key is safe. */ }
}

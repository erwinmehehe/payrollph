/**
 * Operator-only backfill writes. The caller must authenticate each new bank
 * envelope by decrypting and comparing it BEFORE calling either function.
 * No connection, scan, encryption, or write occurs on module import.
 */
export type BankBackfillDatabase = {
  query(text: string, values: unknown[]): Promise<{ rowCount: number | null }>;
};
export type BankBackfillReplacement = {
  id: number;
  /** Preserve original whitespace for an exact compare-and-swap. */
  original: string;
  encrypted: string;
};

function validate(input: BankBackfillReplacement) {
  if (!Number.isSafeInteger(input.id) || input.id <= 0 ||
      typeof input.original !== "string" || !input.original.trim() ||
      typeof input.encrypted !== "string" || !input.encrypted.startsWith("enc:v1:") ||
      input.encrypted.length <= "enc:v1:".length || input.original === input.encrypted) {
    throw new Error("Invalid bank backfill replacement. Nothing was written.");
  }
}

export async function replaceEmployeeBankAccount(
  db: BankBackfillDatabase, input: BankBackfillReplacement,
): Promise<void> {
  validate(input);
  const result = await db.query(
    "UPDATE employees SET bank_account = $1 " +
    "WHERE id = $2 AND bank_account = $3 RETURNING id",
    [input.encrypted, input.id, input.original],
  );
  if (result.rowCount !== 1) {
    throw new Error("Employee account changed during backfill; repeat dry-run.");
  }
}

export async function replacePayrollSnapshotBankAccount(
  db: BankBackfillDatabase, input: BankBackfillReplacement,
): Promise<void> {
  validate(input);
  // Patch the latest stored JSON, not a stale object from the earlier scan.
  // Compare the source account in the SAME statement and never create a
  // missing payment snapshot or coerce a malformed numeric account to text.
  const result = await db.query(
    "UPDATE payroll_entries " +
    "SET trace = jsonb_set(trace, '{payment,bankAccount}', to_jsonb($1::text), false) " +
    "WHERE id = $2 AND trace #>> '{payment,bankAccount}' = $3 " +
    "AND jsonb_typeof(trace #> '{payment,bankAccount}') = 'string' RETURNING id",
    [input.encrypted, input.id, input.original],
  );
  if (result.rowCount !== 1) {
    throw new Error("Payroll snapshot account changed during backfill; repeat dry-run.");
  }
}

# P0-2 — protected production bank-encryption verification and backfill

**Current status:** Code-only controls; this does not close the operational encryption gate or authorize a production backfill, payroll run, payout, key change or migration.

## Evidence required

- Verify the live Vercel project/team and deployed **exact reviewed SHA**. The private readiness route must return the same 40-character SHA, `deploymentEnvironment=production` and the same one-way bank-key fingerprint as the authorized runner. A named environment variable in Vercel is **not** proof of the key bytes, role or deployed SHA.
- DBA/security personnel verify the destination **host**, PostgreSQL database name, current applied migration history/checksums, table permissions, schema and restored backup. The preflight only checks the named database and four required column definitions. Same-named databases can exist on different hosts; the name check alone is not host verification.
- Before **dry-run**, provision the separate protected `PRODUCTION_BANK_AUDIT_DATABASE_URL` account with read access to the four stores but *no write or schema privileges*. The dry-run must not borrow the writer credential. The workflow rejects privileged audit roles and runs the schema guard inside `READ ONLY`.
- To **apply**, supply the reviewed source SHA and DB name, a change-control reference, exact `APPLY_APPROVED_BANK_BACKFILL` confirmation, and approved protected GitHub `production` environment reviewers. The writer secret `PRODUCTION_DATABASE_URL` is only injected into the guarded schema, inventory, apply and verify steps. **`npm ci` gets no production secrets.**
- The dedicated `PRODUCTION_BANK_DATA_ENCRYPTION_KEY` must be valid and must match the live deployment by domain-separated fingerprint. The TOTP-derived fallback is intentionally **not authorized** for this operator workflow. If historical envelopes require a previous key, stop and perform a separately governed full four-store rotation before discarding old keys.
- Approved DBA changes must widen old columns **before** the backfill. The workflow no longer runs `prepare-bank-encryption.ts` or any `ALTER TABLE`. No `db:push`, SQL mutation or runtime migration repair is permitted as a preflight.
- A dry-run reports only the counts of plaintext bank destinations across employees, historical payment snapshots, legal entities and payout-change proposals. The approved apply path rechecks inventory, performs compare-and-swap encryption, enforces zero-plaintext counts, authenticates each nonblank envelope with the current key alone, then checks live readiness. Any shortfall or corrupt envelope fails the gate.
- A successful automation run is evidence for **this bank encryption control only**. Independent pay-role segregation, bank-file/UAT checks, historical backup/export/log disposition, operational key escrow, restore/rollback rehearsal and real-employer authorization remain required.

## Rollback / incident handling

Because encrypted values cannot be recovered without the original key, preserve the key under approved escrow and a reviewed restore point **before** applying. Reverting application source or rotating a key does not restore old plaintext backups. Do not attempt blind SQL rollback of partially completed compare-and-swap re-encryption; freeze writes and reconcile the four-store current/previous-key counts with the DBA and security lead. Do not upload account numbers or raw connection strings to GitHub logs or issues.

## Configuration observation

Vercel variable metadata may list keys without confirming values. Confirm that any database variable scoped to Preview uses a **separate synthetic-data** database, never Production. In particular, inspect the target of `DATABASE_URL_UNPOOLED` if configured for both environments; do not print or copy its value into this repository or an issue.


## Four-store bank key rotation

Legacy `scripts/rotate-sensitive-encryption.ts` is intentionally **disabled for bank rotation** because its old implementation rewrapped only employees and payroll snapshots and overwrote the whole snapshot JSON without compare-and-swap. Government-ID rotation remains a separate task.

The replacement `scripts/rotate-bank-envelopes.ts` handles all four bank stores with 500-row keyset pagination and original-value compare-and-swap. It requires an authorized dedicated current bank key, a separate previous decryption key and the exact DBA-reviewed database name. First run **without `--apply`** to verify that every stored nonempty value authenticates either under the current key or the approved previous key; plaintext and forged envelopes stop the run. `--apply` also requires `BANK_ROTATION_APPROVAL_REF` and literal `BANK_ROTATION_CONFIRMATION=APPLY_APPROVED_BANK_ROTATION`. The first pass validates every record before any writes; the second pass rewraps old-key-only ciphertext.

**Required operator proof after apply:** run `scripts/verify-bank-account-envelopes.ts` using the current bank key, verify zero plaintext/unreadable values across all four stores, reconcile old-key counts, and only then remove the previous key under change control. A live rotation can be partially completed after a concurrency error; do not roll back by blindly restoring old ciphertext. This script does not replace controlled backup/restore acceptance or independent approver sign-off.

## Four-store current-key evidence on the manual DRY RUN (October 12 addition)

The protected **Production Bank Encryption** workflow now uses a distinct
`scripts/audit-bank-envelopes-readonly.mjs --inventory` step after its existing
four-store plaintext count. This is a data verification task, not an encryption
migration. It requires the independently provisioned
`PRODUCTION_BANK_AUDIT_DATABASE_URL` account and the dedicated, protected
`PRODUCTION_BANK_DATA_ENCRYPTION_KEY`. It does **not** accept TOTP-derived
fallbacks or rotation/previous keys as proof. The existing earlier workflow
step must first confirm the exact reviewed live production deployment SHA and
the current key's authenticated private-readiness fingerprint.

The verifier checks the independently selected database name and rejects
superusers, roles with privileged CREATE/WRITE permissions, non-read-only
transactions, non-main commits, and missing/mismatched review SHAs. It scans
all four stores using 500-row keyset pages inside a single
`REPEATABLE READ, READ ONLY` transaction, with
`row_security=off` so PostgreSQL refuses a tenant-filtered scan rather than
silently undercounting an RLS-protected table. The payroll snapshot query
retrieves only the bank-account JSONB path, not whole payroll traces.

For each store, logs contain **counts only**: empty, authenticated using the
current key, plaintext, unreadable/corrupt. A plaintext or unreadable count
above zero is a **failed P0-2 verification** even in dry-run mode. The counts
remain visible in the protected workflow log so the DBA can plan an authorized
backfill or key-rotation reconciliation. No bank values, employee numbers,
full JSON traces or key material are emitted.

An approved `apply` still uses the separately gated compare-and-swap
encryption script and existing current-key verifier. It now additionally runs
the new audit as `--require-zero` with the **independent read-only role**
after the writer completes. A green inventory does not automatically authorize
an apply. Where all bank stores are empty or already current-key authenticated,
the DBA may record the read-only proof without needlessly rewriting records.

**Source evidence vs. live evidence:** unit tests and synthetic PostgreSQL 16
acceptance live at `tests/bank-envelope-audit*.test.mjs` and in the
`bank-envelope-audit-rehearsal.yml` workflow. They demonstrate protocol
behavior only. The gate remains **UNVERIFIED** until the authorized *actual
production* workflow records an exact deployed SHA match, an independently
identified host and database, successful read-only audit with zero bad values,
and signed DBA/security release evidence. Existing plaintext backups, exports,
logs and key escrow still require separate disposition. Never paste a bank
number or GitHub/Vercel database secret into an issue to prove closure.


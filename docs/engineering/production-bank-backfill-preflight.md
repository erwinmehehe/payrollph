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

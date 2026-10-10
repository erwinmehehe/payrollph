# P0 security release gates — bank encryption and payroll release segregation

Status: **code repair in review**. These controls DO NOT certify that live payroll is ready.

## Bank account writes — mandatory encryption in all environments

- Any non-empty value passed to encryptBankAccount now requires a valid 32-byte BANK_DATA_ENCRYPTION_KEY, or an available valid TOTP_ENCRYPTION_KEY from which the domain-separated bank key can be derived. No environment can silently store new plaintext bank account numbers through this function. Employee writes, pending payout changes, payout-change application and employer disbursement edits are routed through it. **New payroll payment snapshots are patched separately in dependent PR #724 because the payout/payroll isolation policy forbids touching the protected calculation engine in this bank security PR. Merge #723 before #724.**
- A malformed explicitly supplied dedicated key does not fall back to the master key. A previous rotation key does NOT count as a write key.
- Existing encrypted envelopes must authenticate before being re-saved. Null/empty values remain null.
- Legacy plaintext DECRYPTION remains available **only** for staged migration/reading; the fix does not magically encrypt rows already in the database.
- An encrypted bank value that cannot authenticate under current/previous key is rejected, never silently replaced or passed through for storage.
- The payroll calculation trace changes are isolated in #724. Until #724 merges, live bank-data backfill and verified current encryption keys are critical to avoid future trace copies from legacy employee rows.

**Operations before opening production to new bank-data writes:**
1. Provision a valid high-entropy dedicated 32-byte BANK_DATA_ENCRYPTION_KEY in the protected deployment secret manager (or deliberately choose an audited valid TOTP-derived key). Never print it in logs, code, issue comments or reports. Set the same effective key for the approved backfill runner.
2. Ensure production and the authorized runner report matching *one-way key fingerprints*, without publishing key material.
3. Run the documented bank-account compatibility backfill in controlled maintenance conditions, including employee account data, stored payroll payment snapshots, legal-entity disbursement accounts and pending/older payout-change proposals. Verify ciphertext format, coverage and zero remaining plaintext for all four stores with the live bank-encryption verification workflow. The guarded backfill uses compare-and-swap for the added legacy stores.
4. Confirm record decryption, PayMongo no-money preflight, masked browser payloads, bank export, and rollback/key-rotation plan in synthetic staging. Ensure any plaintext exports/backups, historical database backups and logs have an explicit disposition.
5. Record reviewer + operator approval before live key activation. A code merge alone does not provision secrets or fix existing plaintext backups.

## Payroll release segregation — mandatory for every organization

- The authenticated session user attempting release must **not** be the assigned checker, actual decision maker (including a delegate) or the designated managed-payroll client approver for the same run.
- Managed-payroll client approval must be distinct from actual/assigned checker approval as well.
- These rules use the existing *transactionally recorded* audit metadata: makerUserId, approverUserId and deciderUserId, filtered to the selected organization, exact approval task and exact payroll run.
- Display names are not evidence. Missing, duplicated, mismatched, incomplete or legacy-only audit ID evidence blocks release (409) until an independently verified checker review is obtained.
- Positive evidence with distinct actors allows the normal release process. Conflict returns 403. The check executes **before** the run's atomic Ready-for-release to Releasing transition and settlement.
- No new SQL migration or policy opt-in is required. This is not a change to payroll calculations or approval decisions. CI receives an ephemeral random encryption key for isolated synthetic fixtures, never a production or reusable key.

**Review scenarios:** same checker/releaser, delegate/releaser, assigned checker/releaser, managed client approver/releaser, legacy no-ID evidence, wrong task, wrong employer, stale approval, duplicate decision log, two-person and three-person organizations, independent release allowed, concurrent retry, MFA enforcement, and financial settlement invariants.

## Explicit launch limitations

- Production live RBAC and encryption checks, tenant staging, treasury/payout integration, bank key provisioning, prior-data backfill, security review, and independent payroll reconciliation remain separate launch gates.
- No feature switches are changed and no production secret, DB record or payout endpoint is altered by this patch.
- Release owner approval and live production readiness evidence are required; green CI alone is not launch authorization.

## Production workflow hardening (2026-10-10)

- The manually triggered Production Bank Encryption workflow is **main-branch-only** and requires environment-specific `PRODUCTION_DATABASE_URL` plus `PRODUCTION_BANK_DATA_ENCRYPTION_KEY` or deliberately approved `PRODUCTION_TOTP_ENCRYPTION_KEY`. Generic `DATABASE_URL`, `BANK_DATA_ENCRYPTION_KEY` and `TOTP_ENCRYPTION_KEY` CI secret fallbacks have been removed to prevent accidental tests/staging backfill.
- Authorized production operators must verify the protected `production` environment, required reviewers, deployment/source SHA, correct production database and key fingerprint before running **any** dry-run. The apply path still requires the existing separate approval and 0-plaintext four-store validation.
- Workflow changes are code under review, **not** evidence that secrets were provisioned, production database inspected or backfill executed. A branch-protection administrator must also address issue #737 before relying on these gates.

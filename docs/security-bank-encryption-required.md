# Bank account writes: encryption required

Security hardening (2026-10-10) from the four-role payroll audit.

`encryptBankAccount` now rejects any nonempty bank-account write when neither
`BANK_DATA_ENCRYPTION_KEY` nor a valid `TOTP_ENCRYPTION_KEY` is configured.
The TOTP fallback is domain-separated using HMAC, never used directly as the
bank encryption key. Invalid supplied keys already cause a hard error.

This preserves **read-only legacy plaintext compatibility** so migration and
reconciliation may identify historical accounts; it does NOT permit newly saved
plaintext bank account numbers. Blank/null values remain null.

Deployment checklist:
- Provision a secret of 32 bytes encoded as 64 hex characters or base64.
- Confirm bank encryption readiness and a live encryption/decryption smoke test
  before enabling payroll employee-import, onboarding, or payout destinations.
- Ensure development/seed jobs that write demo bank accounts have test-only
  encryption secrets; do not use a production key.
- Run the existing bank-account backfill and key-rotation procedures for any
  pre-existing plaintext rows. A fail-closed write does not retroactively
  encrypt historical database values or backups.
- Refuse rollout if any bank write is possible without a configured secret.

Source: `src/lib/bank-account-crypto.ts`. No database migration is required.

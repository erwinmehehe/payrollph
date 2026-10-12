# Dedicated PII key transition (S-2)

Production startup requires a valid dedicated `PII_ENCRYPTION_KEY`. Provision it before deploying this change. No bank or TOTP secret can encrypt new government identifiers or portraits. Do not copy either secret into the new variable. Portraits retain their purpose-specific HMAC derivation; government identifiers use the dedicated key directly.

## Historical fallback rows

Inventory actual key provenance first. Older government identifiers used HMAC-SHA256(parent, `linaw:government-identifiers:v1`); older photos used HMAC-SHA256(parent, `linaw:employee-profile-photo:v1`). The historical parent was the first configured bank key, otherwise the TOTP key. Derive these two AES keys offline under approved key custody; never log the parent or derived keys.

Configure derived bytes as `PII_LEGACY_GOVERNMENT_ID_KEY` and `PII_LEGACY_PHOTO_KEY`. These variables contain purpose-derived AES keys, not parent secrets. Only exact `PII_LEGACY_READ_ENABLED=true` enables them. Existing dedicated-key rotation uses `PII_ENCRYPTION_KEY_PREVIOUS` separately.

Run a reviewed resumable backfill against an isolated restored database first. Scope reads by tenant and primary-key cursor. Decrypt each old envelope, then use `rotateGovernmentIdEncryption` or decrypt/encrypt the portrait under the current dedicated key. Update with a compare-and-swap predicate on the original ciphertext; a concurrent user edit must not be overwritten. Commit bounded batches with an opaque cursor, counts of scanned/rewritten/failed/conflicted rows and no plaintext in evidence. Authenticate every rewritten value, reconcile row counts and test current-key-only reads. Stop on unknown provenance or authentication failure. No backfill is executed by this PR or startup hook.

For live execution require reviewed backup/restore evidence, restricted operator credentials, a tenant allowlist and a maintenance window. Keep the legacy derived keys until all stores and retained recovery copies have a documented disposition. Then disable the legacy-read flag, remove the legacy variables and verify current-only reads. Ciphertext retained in backups follows their retention and key-custody policy; row rewriting cannot erase historical copies.

Rollback during the transition keeps the new dedicated key, previous key and scoped legacy derived keys. Do not roll back to a writer that selects bank/TOTP secrets. If recovery cannot authenticate data, hold writes and reconcile; never replace unreadable values with blanks.

## Verification limits

Executed tests use fictional ciphertext and call the real startup hook, decryptors and rewrap functions. They do not certify a production inventory, production rotation, restore, or actual employer data. UI screenshots are not applicable to this server-only change. The legacy-read flag defaults off; it adds no visible UI.

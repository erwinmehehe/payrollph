# Dedicated PII key transition (S-2)

## Prelaunch development acceptance (October 13, 2026)

**S-2 is development-complete without a dedicated remote staging environment.** The owner confirms PayrollPH has no customers yet. Source PRs [#917](https://github.com/erwinmehehe/payrollph/pull/917), [#931](https://github.com/erwinmehehe/payrollph/pull/931), and [#939](https://github.com/erwinmehehe/payrollph/pull/939) implement dedicated-key startup/worker checks, required encryption writers, default-off legacy reads, and an optional tenant-scoped rewrap. Real startup and synthetic PostgreSQL behavior tests cover missing keys, legacy reads, current-key-only decryption, re-encryption, conflicts, and tenant isolation. These security protections stay on even during development.

**Read-only development inventory (Neon default `main` branch, `neondb`, 2026-10-13):** one organization, eight employees, zero contractors. All five employee government-ID columns (`tin`, `tin_branch_code`, `sss_no`, `philhealth_no`, `pagibig_no`) were blank; contractor TIN had zero records. No existing government-ID envelope in these tables needs legacy migration. The optional ESS photo/identifier tables were **absent**, not verified empty; track development schema alignment separately in [#953](https://github.com/erwinmehehe/payrollph/issues/953). No ciphertext, employee identifiers, or secret values were retrieved. Vercel has `PII_ENCRYPTION_KEY`, bank, and TOTP key **entries** configured for its production-labeled deployment target; presence alone does not prove secret values are distinct, so startup and write checks remain mandatory.

**Pre-client workflow:** use disposable localhost PostgreSQL, fictional employer data, real behavior tests, lint/typecheck and golden payroll suites. A separate staging project, production snapshot/restore, DBA-attested legacy-data rewrite, and rotation rehearsal are **not required** when there are no historical ciphertext records to preserve. Do not turn on `PII_LEGACY_READ_ENABLED` or invoke `rotate-pii-legacy.ts --apply` merely to close S-2. Do not wipe the shared development database: it contains eight employee rows, regardless of whether those are demos.

**When data changes:** if historical encrypted test records appear and must be preserved, inventory their provenance and use the guarded backfill on a separately verified disposable copy first. If confirmed fictional data are disposable, an explicitly approved reset/reseed may be simpler. Before introducing actual customer data or rotating a live key, follow the stricter migration, backup, privacy and operator controls below. The word `production` in Vercel describes a deployment target, not evidence that PayrollPH has paying customers.


Production startup requires a valid dedicated `PII_ENCRYPTION_KEY`. Provision it before deploying this change. No bank or TOTP secret can encrypt new government identifiers or portraits. Do not copy either secret into the new variable. Portraits retain their purpose-specific HMAC derivation; government identifiers use the dedicated key directly.

## Historical fallback rows

Inventory actual key provenance first. Older government identifiers used HMAC-SHA256(parent, `linaw:government-identifiers:v1`); older photos used HMAC-SHA256(parent, `linaw:employee-profile-photo:v1`). The historical parent was the first configured bank key, otherwise the TOTP key. Derive these two AES keys offline under approved key custody; never log the parent or derived keys.

Configure derived bytes as `PII_LEGACY_GOVERNMENT_ID_KEY` and `PII_LEGACY_PHOTO_KEY`. These variables contain purpose-derived AES keys, not parent secrets. Only exact `PII_LEGACY_READ_ENABLED=true` enables them. Existing dedicated-key rotation uses `PII_ENCRYPTION_KEY_PREVIOUS` separately.

Run a reviewed resumable backfill against an isolated restored database first. Scope reads by tenant and primary-key cursor. Decrypt each old envelope, then use `rotateGovernmentIdEncryption` or decrypt/encrypt the portrait under the current dedicated key. Update with a compare-and-swap predicate on the original ciphertext; a concurrent user edit must not be overwritten. Commit bounded batches with an opaque cursor, counts of scanned/rewritten/failed/conflicted rows and no plaintext in evidence. Authenticate every rewritten value, reconcile row counts and test current-key-only reads. Stop on unknown provenance or authentication failure. No backfill is executed by this PR or startup hook.

For live execution require reviewed backup/restore evidence, restricted operator credentials, a tenant allowlist and a maintenance window. Keep the legacy derived keys until all stores and retained recovery copies have a documented disposition. Then disable the legacy-read flag, remove the legacy variables and verify current-only reads. Ciphertext retained in backups follows their retention and key-custody policy; row rewriting cannot erase historical copies.

Rollback during the transition keeps the new dedicated key, previous key and scoped legacy derived keys. Do not roll back to a writer that selects bank/TOTP secrets. If recovery cannot authenticate data, hold writes and reconcile; never replace unreadable values with blanks.

## Verification limits

Executed tests use fictional ciphertext and call the real startup hook, decryptors and rewrap functions. They do not certify a production inventory, production rotation, restore, or actual employer data. UI screenshots are not applicable to this server-only change. The legacy-read flag defaults off; it adds no visible UI.

## Isolated synthetic CI configuration

The four import, browser, pilot and HTTP smoke workflows generate a new masked, in-memory 32-byte `PII_ENCRYPTION_KEY` for their disposable PostgreSQL test run. These are not real production keys and are never included in reports. The server retains its production startup failure if the key is absent. Startup also rejects a PII key that equals the configured bank or TOTP secret, preventing accidental same-key reuse across purposes; this is covered by the synthetic production-boot test.

## S-2 controlled implementation: tenant-scoped legacy rewrap

Use `scripts/rotate-pii-legacy.ts` only after security/DBA review. The command covers employee government identifiers, contractor TIN, employee ID change requests, verified optional ESS IDs and ESS profile photos. Photo bytes are verified against their stored size and SHA-256 before replacement. Existing current-key ciphertext is preserved byte-for-byte. Every update uses tenant ID, row ID and original ciphertext as compare-and-swap predicates; conflicts stop processing. Pages contain at most 100 records per store. It has no UI, payroll calculation, API, migration or feature activation side effects.

Derive legacy purpose-specific keys **offline** from the actual historical parent as described above. Set `PII_ENCRYPTION_KEY` to a **new** independently generated 32-byte secret; never copy bank or TOTP secrets. When old bank/TOTP keys were used at different times, inventory provenance and migrate in separately approved passes with the corresponding derived keys. Do not guess keys or treat unreadable envelopes as blank. The service may read legacy envelopes only when `PII_LEGACY_READ_ENABLED=true`; this flag defaults OFF.

Run a dry-run against a restored, tenant-scoped staging copy first:

```bash
export PII_ROTATION_ORGANIZATION_ID=<approved-synthetic-tenant-id>
export EXPECTED_PRODUCTION_DATABASE_NAME=<verified-target-database>
# Provision current and purpose-derived legacy keys through an approved secret store.
# PII_LEGACY_READ_ENABLED=true is transition-only, not an encryption fallback.
TZ=Asia/Manila npx tsx scripts/rotate-pii-legacy.ts
```

Check scanned/current/rewrap/empty totals, ensure all five stores were successfully authenticated, test restore and obtain separate DBA/security approval. **Only after approval**, run an operator-controlled apply on the intended restored/staging target, with explicit authorization:

```bash
export PII_ROTATION_APPROVAL_REF=<approved-change-reference>
export PII_ROTATION_CONFIRMATION=APPLY_APPROVED_PII_ROTATION
TZ=Asia/Manila npx tsx scripts/rotate-pii-legacy.ts --apply
```

Apply runs an authentication-only pass across every store before starting any changes. It is *not* globally transactional; on interruption, start with a fresh dry-run and reconcile counts. Concurrent changes fail closed instead of being overwritten. Run a final dry-run **without** `PII_LEGACY_READ_ENABLED`, the two legacy keys or `PII_ENCRYPTION_KEY_PREVIOUS`: all in-scope records must authenticate as already-current or empty. Retire legacy keys only after reconciling excluded tenants, other stores, backups, replicas and their retention. Production execution, backup validation and real-employer approval are not performed by this PR.

Important: This command does not backfill plaintext identifiers. Use the separately approved plaintext migration only where explicitly needed. Existing authorization and maker-checker workflows are unchanged; operator write permission and DBA approval remain external controls.

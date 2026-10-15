# #907 — Zero-cloud-cost fictional encrypted restore acceptance (CI only)

**Evidence class:** `SYNTHETIC_ONLY_PASS` if exact-head GitHub Actions succeeds. **Not** `SOLO_DEV_RESTORE_SMOKE`, production data recovery, an external/offsite backup, an independently witnessed restore, or permission for #1061 production SQL.

## Scope and verification

The existing `.github/workflows/encrypted-offsite-backup-ci.yml` exercises only **fictional data** in a disposable PostgreSQL 18 GitHub service container with no Neon URLs, no live employer data, no AWS, no customer funds and no externally provided secrets.

The existing `scripts/rehearse-encrypted-offsite-backup.sh` now tests a stronger physical recovery boundary:

- Seeds 50 fictional rows (total **159,375 synthetic cents**) and advances a deliberately created PostgreSQL sequence to 502.
- Creates a **custom-format PostgreSQL archive streamed straight into age X25519 encryption** on the ephemeral runner. It never saves plaintext `pg_dump` files or emits payroll/PII data.
- Creates a **second detached ciphertext copy** in a separate ephemeral runner directory and verifies its SHA-256 byte-for-byte against the first. This imitates copying to other storage but is **not independent media or durable offsite storage**.
- Rejects ciphertext corruption by digest and rejects decryption with an unrelated age key.
- Restores **only the detached encrypted copy** by streaming `age -d` into `pg_restore --single-transaction --exit-on-error` in a **separate, ephemeral Docker PostgreSQL 18 container** whose inspected Docker networking mode is `none`. The source database is not the restore destination.
- Checks restored fictional row digest, exact sum of integer cents, sequence last value, restored row count, and constraint rejection for an invalid negative amount.
- Deletes the ephemeral encrypted archive, private decryption keys, detached copy and restore container on exit. No full backup or keys are uploaded.
- Emits **only** the sanitized `qa-artifacts/dr-offsite-synthetic.json` result (source/copy ciphertext SHA-256, test counts, synthetic totals and explicit `actualProductionBackup:false`, `independentExternalMedia:false`, `productionCertified:false`). The CI workflow retains that JSON alone for seven days.

The manual `workflow_dispatch` entry (or path-triggered PR test) never requests GitHub environment production secrets. Its only PostgreSQL identity is `postgres` on the short-lived *synthetic service container*, **not** Neon. No production schema, protected credentials or environment is touched.

## What must still happen outside CI

The developer's separately merged `scripts/local-dev-encrypted-recovery.mjs` intentionally **refuses GitHub Actions/CI**. This workflow does not bypass or soften that prohibition. To record `SOLO_DEV_RESTORE_SMOKE`, the operator must use an actual trusted device with PostgreSQL 18 clients, Docker, age, a confirmed fictional-data source, an offline-custodied private key, and a separately owned storage medium following [the original runbook](./p0-4-zero-cost-local-dev-recovery.md). A test-only second directory on GitHub Actions does not count as different physical media.

Actual production recovery under #907 still requires separate authorization for potentially sensitive payroll/banking records, least-privilege backup role, independently durable encrypted storage and witnessed restore; there is no AWS account/budget configured. Issue #1061 must remain **NO-GO** until genuine historical receipts, independently durable recovery evidence and the approved SQL execution path exist. An existing same-project Neon recovery branch and expiring snapshot do not satisfy these conditions.

## Evidence reference

Attach the exact GitHub workflow run URL, source commit SHA, sanitized artifact and passing PG18 job status to issue #907 after an actual run. Do not mark this section as executed before CI succeeds.

# Encryption Backfill — Production Operator Runbook

**Document status:** Instructions only. No production database command, migration, encryption, key rotation, backup, restore, or GitHub Actions workflow has been executed by authoring this file. This runbook is **not** a change approval or a payroll/payout release authorization. A DBA, security approver, and authorized operator must independently verify every gate against the currently deployed application.

**Read and recheck before use:** `scripts/check-bank-backfill-preflight.ts`; `scripts/prepare-bank-encryption.ts`; `scripts/encrypt-bank-accounts.ts`; `scripts/encrypt-government-ids.ts`; `scripts/rotate-sensitive-encryption.ts`; `.github/workflows/production-bank-encryption.yml`; `drizzle/0004_bank_account_envelope.sql`; `drizzle/0008_government_id_envelope.sql`. Related source: `src/lib/bank-account-crypto.ts`, `src/lib/government-id-crypto.ts`, `src/lib/operational-readiness.ts`, `src/app/api/readiness/route.ts`, `src/app/api/readiness/pilot-status/route.ts`, `scripts/audit-bank-envelopes-readonly.mjs`, `scripts/verify-bank-account-envelopes.ts`, `scripts/rotate-bank-envelopes.ts`, and `.github/workflows/live-rbac-sandbox-smoke.yml`.

## A. Preconditions: keys, identity, and Phase 5 backup/restore

1. **Identity and approvals.** Identify the specific deployed production `main` commit, live deployment environment, database name/branch/endpoint, reviewed source revision, separate DBA/security approver, and human operator. Capture a change ticket and an approved maintenance/write-quiescence window. Verify that the GitHub Actions `production` environment has actual protection and authorized reviewers; do not infer protection from its name. Neither a GitHub merge nor a successful synthetic CI test proves production readiness.
2. **Dedicated, independent encryption keys.** `BANK_DATA_ENCRYPTION_KEY` and `PII_ENCRYPTION_KEY` **must both be set and each decode to 32 bytes** (64 hex characters or accepted canonical Base64/Base64URL). Generate/provision using the approved secret store, never a checked-in file. Escrow **each key offline**, separately from encrypted database backups, and verify that recovery custodians can retrieve it. Use a **dedicated** bank key that matches the live deployment and the runner. **No fallback from PII to `TOTP_ENCRYPTION_KEY`**: the actual `src/lib/government-id-crypto.ts` requires `PII_ENCRYPTION_KEY` and does not derive from TOTP. `scripts/encrypt-government-ids.ts` contains an outdated error message mentioning fallback keys; ignore that suggestion. The bank crypto library has a legacy TOTP-derived path, but the production workflow explicitly rejects it; do not use it in this procedure.
3. **Phase 5 is a hard prerequisite to ANY `--apply` or schema mutation.** Before any write, require independently verified evidence of an encrypted backup **and an actual successful restore** to an isolated, non-production destination, with a source/archive identity receipt, ciphertext checksum, restored table/record/sequence reconciliation, offline key recovery, RPO/RTO assessment and DBA/security sign-off. A synthetic CI drill, a backup upload alone, or a snapshot's existence does **not** count. Consult `docs/engineering/p0-4-encrypted-offsite-backup-runbook.md` and `docs/engineering/neon-restore-no-promote-runbook.md`; neither document by itself certifies a completed live Phase 5 acceptance.

HUMAN CONFIRMS BEFORE PROCEEDING

If Phase 5 evidence must be generated, separately authorize a restore **only into a disposable, isolated target**. Prove the original production/default branch and endpoint are unchanged before and after the rehearsal. Never set a restored branch as default, promote it, or use the live production endpoint as a restore test. Retain the verified restore receipt **before** considering any later mutation.
4. **Secrets boundary.** Inject `DATABASE_URL` and key material only via protected operator/runtime credentials. In the bank workflow, `PRODUCTION_BANK_AUDIT_DATABASE_URL` is reserved for the SELECT-only audit role and `PRODUCTION_DATABASE_URL` for the separately controlled apply identity; `PRODUCTION_BANK_DATA_ENCRYPTION_KEY` and `PRODUCTION_READINESS_TOKEN` are protected secrets. **Do not place connection strings into workflow inputs, command arguments, files, issues, logs, or evidence artifacts.** No bank account numbers, government IDs, complete payroll traces, or raw keys may be printed.

## B. Bank path: preflight, workflow dry-run, approved apply, final dry-run

### B1. Catalog preflight; conditional schema preparation

Run `npx tsx scripts/check-bank-backfill-preflight.ts` first in an approved read-only operator context. Supply the protected `DATABASE_URL` secret, `EXPECTED_PRODUCTION_DATABASE_NAME` (only the DBA-verified database name), and `BANK_BACKFILL_ROLE=audit` as execution-environment variables. The script uses a `REPEATABLE READ, READ ONLY` transaction, rejects a wrong database/elevated audit identity, and checks four bank destinations: `employees.bank_account`, `payroll_entries.trace`, `legal_entities.disbursement_account`, and `employee_payout_change_requests.proposed_bank_account`. Require an affirmative schema result; **STOP** on any failure.

`drizzle/0004_bank_account_envelope.sql` widens `employees.bank_account` to `varchar(160)`. `scripts/prepare-bank-encryption.ts` also widens that one column, but it **executes ALTER TABLE and is not a dry run**, has no independent target guard, and does not seal any plaintext. The bank Actions workflow deliberately contains **no DDL**, implicit schema repair or `db:push`. If widening is necessary, stop the backfill until independently approved DBA migration review and Phase 5 evidence exist.

HUMAN CONFIRMS BEFORE PROCEEDING

Only after **verified Phase 5 backup/restore**, approved schema change, exact write-target attestation and migration-history reconciliation may the DBA apply the reviewed `drizzle/0004_bank_account_envelope.sql` **or** run `npx tsx scripts/prepare-bank-encryption.ts` in a separately controlled context. Do not run both blindly. Retain the DDL receipt; repeat `scripts/check-bank-backfill-preflight.ts` in read-only `audit` mode and require all four stores compatible before continuing.

### B2. Reviewed protected workflow dry-run

Open GitHub Actions → **Production Bank Encryption** (`.github/workflows/production-bank-encryption.yml`) on **`main`**. Enter only these workflow-defined inputs:

| Workflow input | Initial dry-run value |
| --- | --- |
| `mode` | `dry-run` |
| `reviewed_sha` | Exact, reviewed **40-character lowercase hexadecimal** `main` SHA, which must equal the workflow's `GITHUB_SHA` **and** be the currently deployed production SHA |
| `expected_database_name` | Independently verified database **name**, `^[A-Za-z0-9_]{1,63}$`; **not** a URL or connection string |
| `approval_ref` | Empty (not required for dry-run) |
| `apply_confirmation` | `NO` (default) |

The workflow checks the protected dedicated bank key, the private readiness token, `deploymentSha`, `deploymentEnvironment=production`, and a **one-way bank key fingerprint**. The fingerprint from `src/lib/bank-account-crypto.ts` must match the currently deployed application. It then uses the separate read-only audit credential and runs `scripts/check-bank-backfill-preflight.ts` in `BANK_BACKFILL_ROLE=audit`, `scripts/encrypt-bank-accounts.ts` **without `--apply`**, and `scripts/audit-bank-envelopes-readonly.mjs --inventory`.

Review the **plaintext inventory for all four stores**, including employee accounts, payroll payment snapshots, legal-entity disbursement accounts, and payout-change proposals. Require existing encrypted envelopes to authenticate under the **current** dedicated key. Retain only sanitized counts and the one-way fingerprint, **never bank values**. Any missing inventory, wrong live SHA/database, key mismatch, unreadable envelope, wrong audit privileges or workflow failure means **STOP**. A `dry-run` is not approval to apply.

### B3. Bank encryption apply — human-approved only

HUMAN CONFIRMS BEFORE PROCEEDING

Require the **verified Phase 5 backup/restore receipt**, a current clean catalog preflight and B2 dry-run, no uncontrolled concurrent writes, the exact still-deployed `main` SHA and matching dedicated bank fingerprint, and a **human-supplied** DBA/security `approval_ref`. The workflow requires its first character to be alphanumeric, followed by 7–120 characters from `[A-Za-z0-9_.:/-]`. Never invent a reference.

Dispatch the same protected production workflow with these **actual** inputs:

| Workflow input | Approved apply value |
| --- | --- |
| `mode` | `apply` |
| `reviewed_sha` | Exact currently deployed and reviewed 40-character lowercase `main` SHA |
| `expected_database_name` | Same independently attested database **name only** |
| `approval_ref` | Actual independently approved human change-control reference |
| `apply_confirmation` | **`APPLY_APPROVED_BANK_BACKFILL`** — literal read from the workflow's validation |

The workflow performs `BANK_BACKFILL_ROLE=apply` database-name/schema preflight, repeats a four-store dry inventory, and only then invokes `scripts/encrypt-bank-accounts.ts --apply`. Post-apply it must enforce **zero identified plaintext in all four stores**, run `scripts/verify-bank-account-envelopes.ts` with the **current key only**, run the independent SELECT-only `scripts/audit-bank-envelopes-readonly.mjs --require-zero`, and confirm the live bank-readiness blocker is absent. A failed or partial step is a **STOP**, never permission to skip verification or enable payouts.

### B4. Final bank dry-run — zero plaintext mandatory

After the apply, **dispatch a new** `mode=dry-run` run (same protected workflow, deployed SHA, database name and fingerprint). It must report: **0 employee accounts needing encryption**, **0 plaintext payroll payment snapshots**, **0 plaintext legal-entity accounts**, and **0 plaintext payout-change proposals**, with **0 unreadable** and **0 plaintext** on the independent current-key-only inventory. Preserve the initial/apply/final run receipts. If production or `main` has changed, first re-attest the new deployment and stop using the old SHA.

## C. Government IDs: dry-run, then approved `--apply`, then zero plaintext

1. **Preflight and schema.** Supply a dedicated `PII_ENCRYPTION_KEY`; never a TOTP fallback. Independently verify the intended database and account privileges because `scripts/encrypt-government-ids.ts` **does not pin the target database or deployed SHA**. `drizzle/0008_government_id_envelope.sql` widens five **employee** columns (`tin`, `tin_branch_code`, `sss_no`, `philhealth_no`, `pagibig_no`) to `varchar(180)`. Separately verify contractor `tin` column capacity; `0008` does not address that column. Do not improvise DDL.

HUMAN CONFIRMS BEFORE PROCEEDING

If `drizzle/0008_government_id_envelope.sql` is required, its separately controlled DBA application is a **mutation**: obtain verified **Phase 5 backup/restore**, confirmed migration history and database identity, independent approval and an audited receipt first. Never bypass failed schema checks.

2. **Dry run.** In an approved operator context, using a protected **read-only** credential tied to the independently attested database, run:

~~~bash
npx tsx scripts/encrypt-government-ids.ts
~~~

Review sanitized JSON counts `employeesWithPlaintextGovernmentIds` and `contractorsWithPlaintextTin`. The script scans employee TIN, TIN branch code, SSS, PhilHealth, Pag-IBIG and contractor TIN. Do not print identifier values.

3. **Apply.**

HUMAN CONFIRMS BEFORE PROCEEDING

Require **verified Phase 5 backup/restore**, human DBA/security change approval, vetted production database/role, an approved dry-run count, and a write-quiescence plan. With credentials injected only through a protected executor, run:

~~~bash
npx tsx scripts/encrypt-government-ids.ts --apply
~~~

On an exception or partial pass, **STOP** and reconcile. Do not skip records, guess a key or downgrade fail-closed writes.

4. **Zero plaintext proof.** Run `npx tsx scripts/encrypt-government-ids.ts` again **without** `--apply` and using approved read-only access. Require `employeesWithPlaintextGovernmentIds: 0` and `contractorsWithPlaintextTin: 0`. These are record-count/envelope-prefix checks, **not proof that ciphertext decrypts**. Obtain independent current-`PII_ENCRYPTION_KEY`-only authenticated-decryption evidence for stored government-ID envelopes; unreadable records block completion.

## D. Private readiness gates, then Actions live RBAC smoke

1. With a private operator client and securely injected `x-readiness-token`, issue `GET /api/readiness` (from `src/app/api/readiness/route.ts`). The endpoint returns 404 when the necessary secret is missing, or 401 when invalid. In the `gates` array, require `ready === true` on **both** `bank-data-encryption` and `government-id-encryption`. `src/lib/operational-readiness.ts` counts employee/snapshot bank plaintext and employee/contractor government-ID plaintext. **This does not replace B4's four-store authenticated audit**, which also covers legal entities and proposals.
2. Examine private `GET /api/readiness/pilot-status`: require the exact `deploymentSha`, `deploymentEnvironment=production`, matching dedicated bank key fingerprint, and neither encryption gate nor `readiness-internal-error` among `criticalBlockers`. Do not interpret these two green gates as overall launch, payroll, filing or payout approval.
3. **Only next**, inspect the **Live RBAC Sandbox Smoke** Actions job defined in `.github/workflows/live-rbac-sandbox-smoke.yml`. Run it on the **exact deployed `main` SHA** only after separate operator approval; it verifies exact deployment, anonymous access denials, six synthetic demo personas and compensation privacy, and can exercise demo/fixture operations. It is *not* an encryption-backfill operator.

HUMAN CONFIRMS BEFORE PROCEEDING

If separately authorized, a human dispatches the `live-rbac-sandbox-smoke` workflow via Actions. Retain its completed passing run receipt; a failure, wrong deployed SHA, unavailable private token or unverified privacy action is a **STOP**. **Do not dispatch it while merely authoring/reviewing this runbook.**

## E. Rollback/recovery and `*_PREVIOUS` key handling

1. **Failure and partial pass.** Stop the window and affected sensitive writes. Retain **current keys**, offline escrow and approved backup evidence. Never disable encryption, recreate bank plaintext, export sensitive values to logs, suppress readiness, or assume all row updates are atomic. Re-run **read-only** inventories, reconcile partial records and concurrent edits, and escalate for a fresh human-approved repair plan. Do not blindly reverse a widening migration.
2. **Controlled recovery restore.**

HUMAN CONFIRMS BEFORE PROCEEDING

Any real recovery restoration is a separate incident-level mutation authorized by the DBA/security owner after inspecting target identity, encrypted archive, available keys, possible lost writes, and RPO/RTO. Start with the isolated proof in `docs/engineering/neon-restore-no-promote-runbook.md`. Do not silently replace the production branch, repoint its endpoint, or treat a synthetic restore as certification. Reverify inventories, authentic decryption, readiness gates and RBAC after an independently authorized recovery.
3. **Bank rotation uses the guarded four-store operator, NOT the legacy combined one.** For a bank key change, secure the new `BANK_DATA_ENCRYPTION_KEY` as current and old `BANK_DATA_ENCRYPTION_KEY_PREVIOUS` as previous (both 32 bytes, separately escrowed). Supply independently vetted `EXPECTED_PRODUCTION_DATABASE_NAME` and protected credentials. `scripts/rotate-sensitive-encryption.ts` **intentionally rejects bank rotation**: its legacy bank path misses two stores and has unsafe whole-trace writes. Dry-run the supported `npx tsx scripts/rotate-bank-envelopes.ts`, inspect counts, and obtain a **fresh Phase 5 verified backup/restore** and independent approval.

HUMAN CONFIRMS BEFORE PROCEEDING

Only then provide human `BANK_ROTATION_APPROVAL_REF` and the script-required `BANK_ROTATION_CONFIRMATION=APPLY_APPROVED_BANK_ROTATION`, and invoke `npx tsx scripts/rotate-bank-envelopes.ts --apply` from the approved operator context. This is **different** from the bank backfill's approval/confirmation. Require `scripts/verify-bank-account-envelopes.ts` and the independent read-only **four-store current-key** audit to prove zero plaintext, zero unreadable and zero previous-key-only envelopes. Retire `BANK_DATA_ENCRYPTION_KEY_PREVIOUS` only after full current-key-only proof and approved backup/replica retention review.
4. **Government-ID rotation may use the combined script's PII-only path.** Install a new `PII_ENCRYPTION_KEY` as current and retain the old key in `PII_ENCRYPTION_KEY_PREVIOUS` during the transition; both must be escrowed offline. `scripts/rotate-sensitive-encryption.ts` rotates employee/contractor IDs **only when its bank-rotation predicate is false**. Do **not** supply a bank current+previous key pair to this combined-script executor. Run `npx tsx scripts/rotate-sensitive-encryption.ts` without `--apply` first, assess counts, and obtain a **fresh Phase 5 verified backup/restore**.

HUMAN CONFIRMS BEFORE PROCEEDING

Only with independent human approval run `npx tsx scripts/rotate-sensitive-encryption.ts --apply` **for government IDs only**. Verify stored IDs decrypt with the new **current PII key alone**, in a restricted verification environment **without** `PII_ENCRYPTION_KEY_PREVIOUS`, legacy-read keys or TOTP fallback; verify final zero-plaintext counts. Remove `PII_ENCRYPTION_KEY_PREVIOUS` from production **only** after separate sign-off and reconciliation of previous-key dependencies, backups and replicas. Do not substitute `TOTP_ENCRYPTION_KEY_PREVIOUS`.
5. **Retain sanitized evidence:** human operator/approver and ticket, actual Phase 5 backup/restore receipt, exact source/deployment/database proof, any schema migration receipt, one-way bank key fingerprint, four-store inventory/authentication reports before/after, government-ID before/after dry-run and current-key proof, both readiness gate statuses, and final RBAC run. Missing proof, any plaintext/unreadable data, wrong key/SHA/database, or another applicable release blocker means **NO-GO**. No part of this runbook enables real payroll or money movement.

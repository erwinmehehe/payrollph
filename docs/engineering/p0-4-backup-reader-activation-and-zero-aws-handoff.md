# P0-4 backup reader proposal — operator-only; no AWS and no live role change

**Status: SOURCE-ONLY PROPOSAL / NOT EXECUTED. Production backup and employer payroll remain NO-GO.**

This companion to the [merged P0-4 release-readiness evidence](p0-4-release-readiness-and-dba-handoff-20261017.md) packages a guarded SQL proposal for the **dedicated, non-login, read-only** PostgreSQL backup role. It is intentionally stored as an ordinary `scripts/sql/` file, **not** under `drizzle/`, and no workflow or startup hook invokes it.

## What is and is not authorized

- The repo owner's [October 14 no-AWS/no-recurring-cloud-spend decision](https://github.com/erwinmehehe/payrollph/issues/907#issuecomment-6167103361) remains binding. No AWS account, IAM role, S3 bucket, KMS key or subscription is created. Do **not** dispatch the dormant AWS workflow.
- The existing [local development recovery helper](p0-4-zero-cost-local-dev-recovery.md) and its CI rehearsals are **fictional-data-only**. They are not a permitted route to export unclassified production Neon records.
- A restricted role can enable a later lawful backup, **but granting SELECT over 136 public application tables and 9 `neon_auth` tables exposes sensitive information once login is enabled**. Role grants are therefore operator/DBA/privacy changes, not application runtime changes. Do not enable the proposed role on production without the review below.
- No encrypted external destination has been approved or connected in this session. A path on the same Neon account, a second provider snapshot, an unencrypted laptop directory, or a ChatGPT/GitHub artifact does **not** satisfy offsite recovery.

## Observed source catalog

On 2026-10-17, a **metadata-only** query to explicitly identified Neon PG18.6 `calm-wave-70219564 / br-lucky-sound-b79i56jw / ep-cool-hat-b7e7gpoo / neondb` found:

| Schema | Ordinary tables | Sequences | RLS-enabled tables |
| --- | ---: | ---: | ---: |
| `public` | 136 | 134 | 0 |
| `neon_auth` | 9 | 0 | 0 |

The five visible login roles are not safe reusable backup readers: four have write privileges on every public table and elevated role flags; `neon_auth` cannot SELECT the 136 public tables. The existing [backup-source guard](../../scripts/sql/protected-neon-backup-source.sql) requires exact target identity, read access to both schemas and the absence of elevation, ordinary data writes and schema/database CREATE privileges.

## Candidate source-only SQL

[Review the proposed operator bootstrap](../../scripts/sql/p0-4-proposed-backup-reader-bootstrap.sql). It performs these actions **only if an authorized DBA explicitly runs it**:

1. Start a transaction and check the exact target project/branch/endpoint/database, required schemas, non-RLS state and baseline table count. Abort on role-name collision.
2. Create `payrollph_backup_reader` with **NOLOGIN, no password, no superuser/role/db creation, NOINHERIT, no replication and no RLS bypass**. The role cannot open a database session.
3. Grant `CONNECT`, schema `USAGE`, and **SELECT** on existing tables and sequences under `public` and `neon_auth` only. Do *not* grant sequence `USAGE/UPDATE`, ordinary table write rights or schema CREATE.
4. Assert the effective role flags, absence of inherited roles, schema privileges, table write/ownership and sequence rights; any failure rolls back the transaction.
5. Leave login disabled and no secret configured. Newly created tables/sequences will need explicit review and SELECT regrants, followed by the same privilege audit.

**This file is not sufficient for production activation**. It does not prove that the DBA has adequate grant authority over Neon Auth objects, that all future schemas are in scope, that a correct and privately controlled role credential exists, or that a suitable backup destination and an independent recovery process have been approved.

## Required operator execution order — before any live SQL

1. **Owner and data privacy:** privately determine whether *actual* Neon contents are fictional or sensitive, approve or reject exporting them to a named custodian/machine/media, identify who controls the decryption key, classify legal retention, and document the media location and loss scenario. Do not post employee data, credentials or decrypted archives in GitHub.
2. **No-recurring-cost storage choice:** if already-owned encrypted offline media is available, document the independent copy and custody process. If it isn't, leave real backup **BLOCKED**; do not substitute AWS or ad hoc public cloud storage without a new owner decision. A finite Neon snapshot is a recovery checkpoint, **not** an independent retained encrypted archive.
3. **DBA SQL review and nonproduction rehearsal:** review the proposed bootstrap, verify each SELECT grant's necessity (including managed Neon Auth), test on a separately authorized disposable PG18 target, and prove **actual effective** table/sequence READ and negative WRITE/DDL/bypass privileges. Do not copy the pinned live branch identifier into an unrelated clone and claim an identity PASS.
4. **Separate, recorded live role-change approval:** if and only if the preceding controls are accepted, authorize the exact reviewed SQL version, operator, branch and change ticket. Review full catalog before granting. Never apply this through `db:push`, runtime hooks or GitHub CI.
5. **Private credential activation:** in a separate controlled session, set a strong role credential using a private secret manager / secure `psql` password mechanism and **explicitly enable LOGIN**. Ensure no private secret appears in command-line arguments, shell history, GitHub code, logs, terminal recordings or chat. Revalidate the installed role under its *actual login session* against [the pinned backup guard](../../scripts/sql/protected-neon-backup-source.sql). It must return `PINNED_READ_ONLY_SOURCE`; an error or `DENIED` blocks export.
6. **Back up and restore only after the media has been approved:** have an authorized trusted operator perform a PG18 direct-TLS `verify-full` source/role check, stream `pg_dump` into age ciphertext **without plaintext files**, write only to approved separately controlled media, retain a privately verified SHA-256 and detached copy, and test decrypt/restore in a new networkless PG18 environment. Validate data, schema, constraints and sequences, recording timings and custody. The *existing fictional-only helper* must not be bypassed for real data.
7. **Release signoff stays separate:** post only redacted proof references, role negative-test summary and archive/restore verification disposition into #907 and #744. Independently resolve audit protection #908, migration provenance #744 and incident #899 before authorizing any production schema repair or real-employer payroll.

## Evidence labels

- `SOURCE_PROPOSAL`: this PR and any source-only test. **Not** a backup or a live role.
- `ROLLOUT_PREPARED`: approved design/fixture negative tests only, no live role.
- `ROLE_INSTALLED_DISABLED`: after separately approved actual production NOLOGIN DDL, only when live proof exists.
- `BACKUP_ENCRYPTED_NOT_RESTORED`: after real ciphertext and custody checks, not recoverability.
- `RECOVERY_VERIFIED`: only after an actual detached restore and verified parity with retained private receipts. Not a real-payroll release authorization.

**Never invent a role, protected media, archive receipt, SQL execution, restored data parity or an independent witness because code or CI passed.**

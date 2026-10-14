# P0 operational release gates — 14 October 2026

**Status: NO-GO.** This is a source-controlled, read-only remediation handoff. No database migrations, branch restores, endpoint changes, role grants, bank payouts, agency submissions or activation of live payroll are authorized by this document.

## Verified target and source

- Repo: `erwinmehehe/payrollph`; review baseline: `main@64f609d3884e410fc9f0a1cae678660484ce7be8`.
- Neon project: `calm-wave-70219564`; original default branch ID `br-lucky-sound-b79i56jw`; database `neondb`.
- Neon default was independently re-read on 14 October as `main`, `default=true`, **`protected=false`**.
- Neon automatic snapshot schedule was **empty**; exactly one returned manual snapshot (`snap-red-sound-b798wnli`) expires **2026-10-19 00:00 UTC**. This is not proven encrypted offsite recovery.
- Vercel project `erwinmehehe-payrollph` has a READY production deployment; source deployment success does **not** establish schema, security, payroll or agency acceptance.
- An attempt to retrieve Vercel runtime logs from the 12 October 05:28–05:36 UTC incident window returned a retention error on 14 October. Missing telemetry means **UNKNOWN**, not zero impact.
- Prior catalog-only probe (see [P0-4 preflight](p0-4-live-schema-restore-preflight-20261014.md)) found 1 of 26 named historical migration prerequisites present, 25 absent, and no verified historical applied-migration receipts. Do not replay numbered SQL blindly.

## Release-hold matrix

| Gate | Owner/reviewer | Evidence needed | Current decision |
| --- | --- | --- | --- |
| P0-4 schema provenance, #744/#920 | Independent DBA + release owner | Exact file SHA, origin migration logs, target DB/branch, missing prerequisites independently resolved, approved forward-only migration and protected clone rehearsal | BLOCKED |
| Protected recovery, #907 | Security + DBA + backup operator | Encrypted offsite object/version/ciphertext digest + retention; OIDC least-privilege roles; offline restore on isolated target; observed RPO/RTO and signed acceptance | BLOCKED |
| Incident, #899 | Incident lead + DBA | Reconciled endpoint/branch identity, logs or recorded telemetry limitations, private per-write assessment, discrepancy signoff | OPEN / impact UNKNOWN |
| Audit integrity, #908 | Security + DBA | Runtime role/grant inventory; tamper-negative tests on disposable PG16+ using actual least-privileged roles; preserved append-only protections | NOT VERIFIED |
| Bank record encryption, #735 | Security + payment owner | Protected 32-byte key provisioning; verified four-store historical backfill; read paths and negative tests; independent segregation of duties | NOT VERIFIED |
| Scheduler + mail, #637/#112 | Operations + release owner | Real deployed hourly jobs, delivery/retry/dedup liveness, restart recovery, error alerting; private environment validation | NOT VERIFIED |
| Connected journey and real payroll, #988/#691/#579 | Independent QA + employer/payroll reviewer | Physical-device 9-stage journey, independently witnessed 14 WFM scenarios, real employer no-money centavo reconciliation (`<= PHP 0.01` unexplained variance) | NOT RUN / NOT ACCEPTED |

## Safe execution order

1. **Preserve target identity.** Obtain operator attestation that application, cron and worker `DATABASE_URL` values resolve privately to original branch `br-lucky-sound-b79i56jw` and original write endpoint `ep-cool-hat-b7e7gpoo`. Never log or paste credentials.
2. **Close recovery risks first.** Obtain S3/KMS/age/backup environment approval under #907, use the existing reviewed backup runbook, produce one encrypted object and independently complete an offline restore. Do not call snapshot restore on default, and do not use implicit `finalize=true`. Separately have the Neon operator consider branch protection and supported plan limits; no automatic production setting change here.
3. **Investigate #899.** Collect retained incident evidence from applicable application, edge, workers and provider systems; document anything missing. Assess potential writes during misrouting without copying or exposing employee or bank data.
4. **Fix schema provenance.** Follow `docs/engineering/p0-4-live-schema-restore-preflight-20261014.md` and `docs/sql/issue-910-read-only-catalog-probe.sql`. Review all source SHA and duplicate-number groups. Do **not** infer an applied SQL receipt from a table's existence.
5. **Rehearse on isolated clone only** after backups, privileges, tenant boundaries, history attribution and rollback are accepted. Use canonical migration runner with separately authorized forward-only releases, never `db:push` against main.
6. **Separate runtime roles and validate negatives** for audit-chain tampering. Test the exact scoped SQL/role configuration on a disposable DB before authorization of any production change.
7. **Validate bank-encryption, scheduler and mail deployment** via private evidence and independent signoff. Preserve default-OFF release holds for money movement, agency transmission and unsupported filing formats.
8. **Only then start independent employer journey acceptance**, WFM UAT and no-money real employer parallel payroll. A synthetic CI PASS does not replace physical-device/real-employer evidence.

## Required independent acceptance record

For each gate, record privately: change/ticket ID, exact git/SQL SHA, source + target branch/database/endpoint identifiers, UTC time, operator and separate reviewer, evidence reference with no secrets/PII, rollback or drill observations, test results, and **PASS/BLOCKED/FAIL**. Public issue comments may contain only redacted state and a secure-evidence receipt identifier. **Absent proof stays BLOCKED.**

## Explicit prohibited shortcuts

- No production DDL, migrations, default-branch or endpoint changes, restore/finalize, or privilege changes in this PR.
- No claim that source code merged equals database migration applied.
- No claim that an expiring Neon snapshot is an encrypted offsite backup.
- No unreviewed bank-file release, live payout, government e-filing, or employer go-live.
- No closing #899 solely because historical Vercel logs are unavailable.

## Tracking

- [#744](https://github.com/erwinmehehe/payrollph/issues/744) master P0 remediation
- [#907](https://github.com/erwinmehehe/payrollph/issues/907) protected encrypted offsite backup and independent restore
- [#899](https://github.com/erwinmehehe/payrollph/issues/899) Neon incident follow-up
- [#908](https://github.com/erwinmehehe/payrollph/issues/908) audit-chain privilege isolation
- [#735](https://github.com/erwinmehehe/payrollph/issues/735) bank encryption / segregation of duties
- [#637](https://github.com/erwinmehehe/payrollph/issues/637) scheduler liveness
- [#112](https://github.com/erwinmehehe/payrollph/issues/112) pilot readiness

**Disposition:** source documentation may be reviewed/merged without activating live systems; operational P0 remains NO-GO until independent evidence is signed.

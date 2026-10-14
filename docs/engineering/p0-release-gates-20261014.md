# P0 operational release gates — 14 October 2026

**Status: NO-GO for real-customer launch and any live-money/agency activity.** This is a source-controlled, read-only remediation handoff. Payroll PH currently has a **solo developer and no paying customers**. A separate DBA, security officer or QA employee is **not required** for internal development rehearsals using fictional data, but technical permission boundaries, evidence and launch gates remain intact. No database migrations, branch restores, endpoint changes, role grants, bank payouts, agency submissions or activation of live payroll are authorized by this document.

## Verified target and source

- Repo: `erwinmehehe/payrollph`; review baseline: `main@64f609d3884e410fc9f0a1cae678660484ce7be8`.
- Neon project: `calm-wave-70219564`; original default branch ID `br-lucky-sound-b79i56jw`; database `neondb`.
- Neon default was independently re-read on 14 October as `main`, `default=true`, **`protected=false`**.
- Neon automatic snapshot schedule was **empty**; exactly one returned manual snapshot (`snap-red-sound-b798wnli`) expires **2026-10-19 00:00 UTC**. This is not proven encrypted offsite recovery.
- Vercel project `erwinmehehe-payrollph` has a READY production deployment; source deployment success does **not** establish schema, security, payroll or agency acceptance.
- An attempt to retrieve Vercel runtime logs from the 12 October 05:28–05:36 UTC incident window returned a retention error on 14 October. Missing telemetry means **UNKNOWN**, not zero impact.
- Prior catalog-only probe (see [P0-4 preflight](p0-4-live-schema-restore-preflight-20261014.md)) found 1 of 26 named historical migration prerequisites present, 25 absent, and no verified historical applied-migration receipts. Do not replay numbered SQL blindly.

## Release-hold matrix

The developer may perform the development-stage roles personally. A role in the table is a **responsibility**, not a requirement to hire someone. The proof standard changes for real-customer/payroll launch; no self-executed test may be mislabeled independent.

| Gate | Responsible role(s) | Evidence needed | Current decision |
| --- | --- | --- | --- |
| P0-4 schema provenance, #744/#920 | Solo owner acting as developer/DBA | Exact file SHA, authentic origin migration receipts or explicit UNPROVEN, target DB/branch, prerequisites resolved, forward-only SQL, rollback-only or isolated-clone tests; separate production change approval when applicable | BLOCKED |
| Protected recovery, #907 | Solo owner operating distinct backup and restore credentials | Actual encrypted S3 object/version/ciphertext digest + retention; scoped upload and restore OIDC roles, private key isolation; *separate-session* offline restore with integrity checks; observed timings. Label a solo dev drill SOLO_VERIFIED_DEV, not independently approved or production-certified | BLOCKED |
| Incident, #899 | Solo owner as incident investigator | Reconciled endpoint/branch identity, available logs or recorded telemetry gaps, private per-write assessment, evidence-based discrepancy disposition | OPEN / impact UNKNOWN |
| Audit integrity, #908 | Solo owner as database/security operator | Actual runtime role/grant inventory; automated rollback-only tamper-negative tests on disposable PG16+ using restricted roles; preserved append-only protections | NOT VERIFIED |
| Bank record encryption, #735 | Solo owner with separate runtime and maintenance credentials | Protected 32-byte key provisioning; verified four-store backfill and read paths; negative tests, maker/checker permissions enforced **in software**. Separate approval/real employer acceptance before real funds are moved | NOT VERIFIED |
| Scheduler + mail, #637/#112 | Solo owner as operator | Actual deployed hourly jobs, delivery/retry/dedup liveness, restart recovery, error alerting; private environment validation | NOT VERIFIED |
| Connected journey and real payroll, #988/#691/#579 | Solo owner for fictional DEV UAT; later real employer/payroll checker for pilot evidence | Physical-device 9-stage journey and 14 WFM scenarios can initially be self-tested as SOLO_DEV; real employer no-money centavo reconciliation (zero unexplained differences greater than PHP 0.01) and genuine external witness/acceptance must be recorded separately when a pilot begins | NOT RUN / NOT ACCEPTED |

## Solo-developer controls that cannot be waived

- Keep **separate** backup/upload and restore/decryption environments, roles, secrets and manual dispatch runs; the same person may operate them but must not consolidate their permissions. For GitHub environment protections, do not configure an impossible sole-reviewer + *Prevent self-review* combination; retain main-only branch rules, explicit actors, exact SHA/confirmation inputs and a clear run audit trail.
- Use fictional data and isolated PostgreSQL for initial UAT. Never assume an apparently development-only database lacks sensitive personal or banking information; review actual data handling and AWS costs before exporting anything.
- Product maker/checker and tenant isolation are enforced by independent **accounts/privileges** and test assertions; one developer can exercise both test accounts, but must not represent that as two independent humans.
- PR merges, a green GitHub workflow, and SQL files on `main` **do not prove Neon production schema has been migrated**. The 12 October incident impact remains UNKNOWN where logs or authenticated receipt evidence are missing.
- A production or real employer pilot will need the applicable employer/payroll acceptance and operational safeguards regardless of team size. Bring in a second reviewer only when an actual risk, regulation or customer acceptance requires one; otherwise record the solo workflow transparently.

## Safe execution order

1. **Preserve target identity.** As the solo operator, record a private target-identity check showing that application, cron and worker `DATABASE_URL` values resolve to original branch `br-lucky-sound-b79i56jw` and original write endpoint `ep-cool-hat-b7e7gpoo`. Never log or paste credentials.
2. **Close recovery risks first.** As owner, explicitly accept AWS cost, Object Lock compliance retention and handling of any real payroll/PII; use [#999's solo-developer AWS setup runbook](https://github.com/erwinmehehe/payrollph/blob/p0-907-aws-offsite-infra/docs/engineering/p0-4-aws-offsite-infra-setup.md) and existing #906 backup/restore workflows. #999 is source-only until AWS is actually deployed. Produce one real encrypted object and verify a restore in a **separate offline session/role**; record the run as solo-verified if you are the only human. Do not call snapshot restore on default, and do not use implicit `finalize=true`. Separately have the Neon operator consider branch protection and supported plan limits; no automatic production setting change here.
3. **Investigate #899.** Collect retained incident evidence from applicable application, edge, workers and provider systems; document anything missing. Assess potential writes during misrouting without copying or exposing employee or bank data.
4. **Fix schema provenance.** Follow `docs/engineering/p0-4-live-schema-restore-preflight-20261014.md` and `docs/sql/issue-910-read-only-catalog-probe.sql`. Review all source SHA and duplicate-number groups. Do **not** infer an applied SQL receipt from a table's existence.
5. **Rehearse on an isolated disposable database only** after backup readiness, scoped privileges, tenant boundaries, history attribution and rollback are documented. Use canonical migration runner with separately authorized forward-only releases, never `db:push` against main.
6. **Separate runtime roles and validate negatives** for audit-chain tampering. Test the exact scoped SQL/role configuration on a disposable DB before authorization of any production change.
7. **Validate bank-encryption, scheduler and mail deployment** using reproducible private operator evidence; classify solo-dev acceptance separately from any future external/pilot signoff. Preserve default-OFF release holds for money movement, agency transmission and unsupported filing formats.
8. **Run fictional internal employer journey and WFM UAT on phones using separate test accounts and role permissions**, even if the single developer plays each role in separate sessions. Record this as SOLO_DEV, not independent human acceptance. A later no-money real employer payroll pilot and independent employer/checker acceptance remain separate. A synthetic CI PASS does not replace physical-device/real-employer evidence.

## Development evidence vs. real-customer acceptance

For each gate record privately: change/ticket ID, exact git/SQL SHA, source + target branch/database/endpoint identifiers, UTC time, the **actual operator**, credential/role identities by approved nonsecret alias, evidence location (no secrets/PII), test assertions, rollback or drill observations, and **PASS/BLOCKED/FAIL**. Record a distinct reviewer **only if one actually participated**.

- **SOLO_DEV_PASS** means the sole developer ran and documented a genuine fictional-data test. It is useful engineering evidence and does not require hiring staff.
- **SOLO_VERIFIED_DEV_RECOVERY** means a real encrypted backup was produced and recovered from a **separate session, AWS role and age private key** by the same developer. A synthetic CI restore or a Neon expiring snapshot is not equivalent.
- **EXTERNAL_PILOT_ACCEPTED** may be claimed only when the actual employer/independent payroll checker or other genuinely separate authorized party has witnessed or accepted the specific real-employer evidence. Do not mark this for yourself.
- **PRODUCTION_RECOVERY_CERTIFIED** requires a validated, retained backup/restore process, data/sequence fidelity, meaningful RPO/RTO evidence and applicable privacy/retention approval; it is not automatically earned by one self-run development drill.

Publish only sanitized status and a restricted evidence receipt identifier on GitHub. **Absent proof stays BLOCKED** even when CI is green or source PRs are merged.

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

**Disposition:** this source-only document may be reviewed/merged without activating live systems. A solo operator may self-verify fictional-data DEV work with accurate evidence labels. Live payments, real-customer launch and production migration remain **NO-GO** until the separately applicable operational/real-employer evidence is met.

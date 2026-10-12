# PostgreSQL 18 compatibility gate for unmerged PayrollPH migrations

This additive draft depends on migration train PR #865, but **does not approve it for merge or production apply**.

Both the existing WFM SQL contract rehearsal (proposed 0117 first payroll, 0118 WFM rules, 0120 optional punch evidence) and the payout foundation/connector rehearsal (0115, 0116, 0119) now run in parallel against **independent disposable PostgreSQL 16 and 18 GitHub Actions services**.

- The CI code refuses non-local URLs, wrong database/user/version, nonempty schemas, and missing explicit CI-only release gates.
- WFM tests execute the exact SQL twice with fictional employees from two tenants, exercise FK/UNIQUE/CHECK and pending-review controls, then rollback all. A separate run injects a foreign-key error after DDL and verifies rollback.
- Payout tests execute actual guarded migration SQL, perform cross-tenant negative insertions and invalid-provider checks, and verify rollback. They make no transfers.
- All new and existing feature switches remain default OFF. No payroll-engine math, production DB, Neon staging DB, real money, employee photos, or provider integration is modified by these tests.
- Source-only grep tests were removed from the payout suite in favor of the executed SQL assertions. PostgreSQL version is verified inside each harness, rather than merely trusting a CI matrix label.
- PASS on PostgreSQL 18 **does not establish** that the live Neon production-copy branch accepts DDL with its 112-table drift, nor a verified historical receipt ledger or a tested restore. The prior Neon connector safety rejection still stands.
- Required to promote later: independently authorized DBA staging-migration runner; real PostgreSQL 18 Neon clone acceptance; full GitHub CI including payroll goldens and TZ=Asia/Manila; DPO/HR/finance/security approvals; rollback and outage reconciliation; no cross-tenant/entity leakage. Do not change the production Vercel build hold.

Test evidence: both matrix jobs in the pull request checks, plus the WFM sanitized evidence artifacts retained for 14 days by major version.

# Loan Management tenant GAP recovery - two independent method targets

**DRAFT / NOT ACCEPTED / NO COVERAGE CREDIT UNTIL INDEPENDENT REVIEW.**

At selection on October 27, 2026, the authoritative method manifest recorded 182 GAPs,
including the following two loan-family methods.

| GAP method | Exact evidence | Further acceptance |
| --- | --- | --- |
| PATCH /api/loans | Existing real-PG16 loans.mjs write-table proof: owned historical loan PAUSE, distinct fictional checker, own DB status/audit transition, two attacker sessions, genuine higher-ID victim loan 403 and unchanged victim state | Independent review of the supported PATCH action scope; one safe pause does not prove all other loan actions |
| POST /api/loans/schedule-preview | New real localhost PG16/HTTP proof: company, agency and floor preview 200 with unique own evidence; victim/other employer 403, anonymous 401, invalid cents 422 and unchanged payroll/loan rows | Exact-head workflow pass, all three preview branches and source/authorization review |

**Potential after approved recovery of both: 182 GAP to 180 GAP. The
current count remains 182.** A successful synthetic CI run alone is NOT
coverage acceptance or a manifest-credit event.

## Isolation from currently open PRs

No active Loan Management PR was present at selection. This family is distinct
from the open identity/account, employee self-workforce and WFM demand
governance families. All five paths are new and do not modify the existing
shared runner, loan row, payroll calculation, or other PR-owned files.

## Executable isolated PostgreSQL and HTTP proof

The dedicated workflow uses a freshly empty disposable PostgreSQL 16
at 127.0.0.1:5432/app_db and a production-mode Next server at
127.0.0.1:3000. It refuses hosted targets, non-CI/prod-real provider
credentials, nonempty DBs and active loan deduction or settlement flags.

1. Seed two independent fictional employer owners and a real higher-ID
   victim owner/worker with persisted authorized MFA sessions.
2. Snapshot all three employers' organization, workers, pay profiles,
   pay revisions, loans, repayments, payroll runs and entries and audits
   before requests.
3. Require own employer 200 for exact centavo company schedule,
   imported agency schedule and net-pay floor previews. Real employer
   A response must fail employer B's proof.
4. Both attackers name actual foreign employer IDs in otherwise valid
   requests. Foreign 403, anonymous 401, invalid kind/centavo 422.
   A forged override in the input never authorizes deduction.
5. Compare all three before/after DB snapshots, including victim
   loans, payment and payroll state, for deep equality.
6. Run the existing write-table Loans family under TENANT_TABLE_FAMILY=loans
   to prove real owned pending POST and an owned historical PAUSE PATCH,
   real victim denial, exact DB and audit transition. The PATCH test
   deliberately does not approve, resume, close or record a payment.

This is not a synthetic provider call, an employee wage deduction,
a payroll run, a loan release, or production UAT.

## Exclusive new files

- scripts/qa/tenant-loan-schedule-tenant-proof.mjs
- scripts/qa/tenant-loan-schedule-tenant-http.mjs
- tests/tenant-loan-schedule-tenant.test.mjs
- .github/workflows/tenant-loan-gap-recovery.yml
- docs/qa/tenant-loan-gap-recovery.md

Seven source and mutation-negative tests help detect false positive
isolation evidence. Only GitHub Actions at the **exact final PR head**
can establish actual PostgreSQL/HTTP execution.

## Required follow-up: recover API GAPs explicitly

After exact-head workflow, full CI/security gates and independent review:

- Pin the exact successful PG16 job and commit plus method-specific
  positive/negative/unchanged-victim evidence to an acceptance record.
- Decide whether additional PATCH loans actions are necessary before
  whole-method credit; do NOT infer comprehensive coverage from PAUSE alone.
- Reconcile the canonical manifest/inventory in a coordinated follow-up
  PR from the latest main, with reviewed anchors and accurate status
  counts only for approved methods. Do not edit global files in parallel
  proof PRs. The numeric GAP total changes ONLY on that approved update.

This proof PR makes no runtime authentication, finance, provider,
payroll, migration, feature-flag, global ledger, manifest, credit-writer,
deployment or release-gate changes. **DRAFT / ZERO NEW COVERAGE CREDITS
UNTIL INDEPENDENT ACCEPTANCE.**

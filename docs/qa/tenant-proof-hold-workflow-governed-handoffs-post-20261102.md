# Proof-only hold: POST /api/governed-handoffs

**NOT ACCEPTED. GAP. ZERO NEW METHOD CREDITS.**

- Re-fetched origin/main baseline: `11b6d544cf6bd30c84fc524a088f90627dec09e6` on 2026-11-02.
- Merged source fix PR: #1673.
- Manifest route blob: `fa7039cee62df7624e3124e75e6566294de32c68`.
- Existing candidate/contract: `NO COMPLETE POST CANDIDATE IDENTIFIED (source contract: tests/tenant-governed-handoff-post-error-boundary.test.mjs)`.
- Manifest reason: Error redaction is source-only; handoff and audit remain distinct transactions and PG16 proof is pending.
- The canonical manifest remains untouched: this PR changes no `status`, no `testedBy`, no counts.

## Four independent evidence gates on the exact FINAL head

1. Legitimate positive. Two distinct fictional authenticated employers execute a real positive under this same HTTP method (or for a token-only worker, prove the documented worker-authenticated own-write alternative). Assert nonempty response and SQL-persisted own records.
2. Real victim denial. A different employer's actual PostgreSQL-seeded ID, read back after insert and higher than both attacker comparator IDs, must be refused with the endpoint's exact contracted status, no side-channel disclosure. Invented ID, unauthenticated 401, disabled 501, rate-limited 429 and empty success do not count.
3. Unchanged victim database. Snapshot victim source, target, payroll, audit, outbox and other connected tables before and after foreign/forged attempts; require SQL equality and no unintended external delivery.
4. Forged selector. Exercise foreign `organizationId`, `employeeId`, relevant legal employer, route object and domain IDs. Reject or show that selector is ignored while own-only persisted state remains.

## Method-specific outstanding proof

Own source-policy handoff POST, higher-ID foreign source refusal, forged source/organization/policy ID, full before/after handoff/approval/audit rows, injected audit-write failure to detect non-atomic partial commit.

## Environment and receipt

No exact-head proof was run or passed for this branch. Disposable PG16 sandbox provisioning was denied with 403; local PG16/GitHub clone runtime is unavailable. Reuse the existing candidate when identified, extending it only for missing variants; do not replace a useful fictional PG16 runner. On an authorized CI runner, record final branch SHA, immutable test lines for all four gates, actual HTTP statuses, SQL victim before/after and a passing GitHub Actions job URL. Require independent security/coverage-owner review before promoting GAP.

All fixtures must be fictional, with two attacker employers plus a separate victim, only disposable PostgreSQL 16 and real localhost HTTP. No production SQL, Neon, secrets, customers, real provider, email, payroll or money. Money, payout, provider and CSP flags OFF; a flagged path can use a temporary disposable test profile only. No production enablement. Never loosen a guard or weaken assertions. Any discovered source isolation defect requires a **separate, clearly labelled source-fix commit** and a rerun on the new exact final head.

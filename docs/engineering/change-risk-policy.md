# PayrollPH change-risk, independent-review and release policy

**Purpose:** separate *source merge*, *deployment/feature activation* and
*real-employer payroll or money movement*. A passing source test is not
business authorization to pay employees or initiate transfers. This policy
implements P0-3 from the October 10/12 panel re-audit.

## PR risk tiers and source merge requirements

| Tier | Scope | Required source-merge checks | Real-environment activation |
| --- | --- | --- | --- |
| **T0** | Public copy and non-executable documentation | Maintainer review, applicable CI, queue gate; self-review allowed | Ordinary release controls |
| **T1** | Non-sensitive UI and general application logic | Current-head applicable tests and maintainer review; self-review allowed | Smoke test and rollback if deployed |
| **T2** | Payroll calculations, approval logic, HR security, employee data, scheduler and WFM | Current-head CI, focused financial/tenant/security tests, **one named independent human approval** on exact SHA, queue gate | Explicit feature-flag and, for live employer work, business/operational acceptance |
| **T3** | Payout, bank/PII encryption, provider integrations, schema changes, financial ledger and money release | Current-head CI, golden/DB/integration/security evidence, migration/rollback plan, **one named independent human approval** on exact SHA, queue gate | Separate DBA/treasury/employer maker-checker-release authorization; never from code merge |

The automated classifier is **conservative but not exhaustive**: high-risk
behavior hidden in a differently named file is still high-risk. The
read-only workflow `Independent Payroll Change Review Gate (P0-3)` also
checks explicit payroll/payout/approvals/bank/scheduler/SQL/workflow paths,
including old paths of renamed files. A PR must not be reclassified
downward merely to bypass a reviewer. Draft high-risk PRs do not pass
review acceptance.

A named independent reviewer must be a *real GitHub human* with
`write`, `maintain` or `admin` repo permission, be included in the
owner-managed `PAYROLL_INDEPENDENT_REVIEWERS` allowlist, **not be the PR
author**, and approve the exact current commit after all changes. Old-head
approvals, dismissed reviews, changes requested, AI or bot accounts,
and an empty reviewer roster fail closed. The reviewer must check the
actual code, golden cases and business effect, not merely press Approve.

## Pilot freeze

Until a first real employer pilot is independently accepted to start, do
**not merge optional HCM or WFM source lanes**, including talent, Worker 360,
planning, compensation and performance, WFM coverage/smart recovery and
their associated API, scripts, tests and migrations. The enforcement gate
keeps these paths frozen unless a separate `PILOT_HCM_WFM_STARTED=true`
flag and `PILOT_START_EVIDENCE_REF` are configured by authorized
operators after real recorded acceptance. A pair of variables does not
itself certify the evidence. Core People, Time, Payroll, Leave, Payslip,
Approvals, Exports, Audit and Compliance fixes remain eligible when they
pass independent review and current-head checks.

## Three review-ready PRs maximum

`PR Integration Queue Gate` continues to cap **review-ready PRs at 3**.
Extra candidates stay draft, so reviewers can finish and verify meaningful
changes instead of accumulating overlapping financial and schema patches.
Reserve new SQL sequence numbers across open PRs and independently confirm
live applied migration receipts before executing any schema change.
Never renumber already applied SQL or batch-merge conflicting financial PRs.

## Source merge is not authorization for real money

1. **Source:** Preserve exact PR SHA, independent review link for T2/T3,
   source diff, dependency chain, CI/golden/security tests, staged flags,
   rollback/repair plan and queue status. A later commit requires a fresh
   approval. Never fabricate a human review.
2. **Activate:** The owner/operator separately verifies which deployment
   SHA and isolated staging DB are being used, and obtains security,
   application, DBA and payroll acceptance for the feature being enabled.
   All new scheduler, AI, provider and high-risk modules remain default-OFF
   until the applicable staging and operational gates are completed.
3. **Real payroll:** Employer authorization, two real parallel payroll
   months, centavo-level reconciliation with an independent checker, official
   agency import acceptance, bank UAT and release committee sign-off remain
   mandatory. A source approval or CI run does **not** release payroll records
   or bank funds.
4. **Database/bank data:** An independently approved DBA process must
   inspect actual production schema receipts, encryption keys, backups,
   audited backfill and restore evidence *before* applying SQL or altering
   confidential data. A PR must not implicitly trigger live migrations.
5. **Main protection:** Use an enforced GitHub ruleset requiring independent
   approvals and selected status checks. Do not bypass failures by direct
   push, owner's self-merge, a temporary ruleset disablement or a fake bot
   account. A documented emergency break-glass action still requires
   a second recorded human approver and post-incident review.

## What is implemented vs still pending

The new source policy is `scripts/lib/independent-pr-review-policy.mjs`
with GitHub metadata verification in
`scripts/check-independent-pr-review.mjs` and a trusted-default-branch
`pull_request_target` workflow. Its code does **not** create reviewer
accounts, change repo permissions, approve/merge a PR, deploy to Vercel,
move money or activate production flags.

As of October 12, 2026, the GitHub ruleset **Protect main** was visible
but set to `disabled` with zero required approvals/status checks.
GitHub administrator action, a named real reviewer, active branch
protection and an independently witnessed failing/passing PR rehearsal
are required before P0-3 can be closed. The present GitHub integration
cannot edit the ruleset. For the exact setup and tests, see
[Independent Review Gate](independent-review-gate.md).

The existing `.github/workflows/pr-change-risk.yml` is an advisory
source classifier; the `PR Integration Queue Gate` checks review WIP
and migration reservations. Neither can by itself authorize live
payroll. The standalone independent-review check must become a **required
branch check** to prevent merges without human approval.

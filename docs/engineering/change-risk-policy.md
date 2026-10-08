# PayrollPH change-risk and merge policy

Purpose: keep routine engineering fast while protecting payroll money, identity, statutory calculations and production data. A GitHub merge, staged feature activation and release of real payroll are three **different decisions**.

## Classification

| Tier | Changes | Before merge | Before production activation/deployment |
| --- | --- | --- | --- |
| T0 — low | Documentation, marketing copy and non-executable assets | Normal CI where applicable; maintainer may merge without a separate approval meeting | Ordinary release check |
| T1 — standard | Non-sensitive UI and general application behavior | Green applicable CI and maintainer code review | Functional smoke test and rollback plan |
| T2 — sensitive | WFM/payroll calculations, employee workflows, identity, security and AI-generated automation | Green exact-head CI and focused domain/security review by someone other than the author when independent review is required by the affected control | Isolated scenario-based staging and owner acceptance; AI features remain OFF until authorized |
| T3 — financial/structural | Compensation financial state, bank/payout execution, financial recovery controls, schemas/migrations and ledger integrity | Green exact-head CI, an independent security/financial reviewer and a safe migration/activation decision where applicable | Witnessed DBA change/restore, payroll/agency/bank/privacy proof appropriate to the action, and explicit release authorization |

Paths are conservatively classified by the advisory PR Change Risk workflow. The highest-risk changed file determines the suggestion. Reviewers must **increase** the tier if a diff has a sensitive effect hidden in a low-risk path; a filename result is not an approval. The workflow does not bypass branch protection.

## Separate merge, deployment and payroll acceptance

1. **Merge** requires code quality and security evidence appropriate to the tier. The owner can merge a T0 routine change after required checks. Author/self-review is not independent approval where one is required.
2. **Staging or feature activation** requires the tests for the specific changed behavior, with only synthetic data unless a real-employer test has separately been authorized. A default-OFF feature may be merged after code review while its live-provider staging gate remains blocked for activation.
3. **Production payroll or payout** always requires employer-specific authorization and relevant bank/statutory, privacy and recovery evidence. Green CI, an issue checkbox or a GitHub merge cannot certify real payroll or authorize transfer.
4. Do not apply SQL migration, backfill salary/financial events, enable a worker, send a payout or reuse production credentials as part of automated PR acceptance.
5. The author can coordinate review but cannot claim an independent reviewer signed off. If a required independent reviewer or staging environment is unavailable, record the blocker and leave the unsafe activation/release disabled.
6. Review evidence must use current PR SHA. New commits or a merge from main require rerunning checks and refreshing security review of changed code. Keep confidential employee, banking and salary evidence outside GitHub.

## Applying this policy to the active PRs

- **#599 WFM oversized punch** — T2 payroll-accuracy change. Existing synthetic checks can support code review and merge; independent Philippine payroll treatment and witnessed 9+-day / eight-day staging controls are needed before live release. Tracking: #629.
- **#609 Automation Studio language drafting** — T2 security/AI change. Independent exact-head code/intent/security review (#621) before merge. Its server-side default-OFF switch must remain OFF until isolated live-provider and UI staging acceptance (#622).
- **#626 compensation consolidation** — T3 salary/outbox and migration change. Independent security/privacy review, authenticated recovery-operator controls and witnessed schema migration/rollback (#630) are required before activating compensation writers or queue recovery. Leave unmerged while high-impact unsolved security/design defects remain.
- **#612, #614, #615, #617, #619, #620, #623, #625** — overlapping drafts. Do not merge separately. Once #626 is reviewed, merged and independently reconciled, close these as superseded without duplicating financial code.

## Review record

Every sensitive PR should identify the exact SHA, change scope, risk tier and why, CI workflow URLs, reviewer identity (not the author), security findings, staging/activation scope, rollback conditions and an explicit merge decision. Production change-control receipts and real-employer proof remain private.

## Advisory workflow behavior

`.github/workflows/pr-change-risk.yml` checks code-owned paths and writes a suggested tier to the GitHub job summary. It has **read-only** repository permission, uses no secrets, never approves or merges a PR and never edits labels. The classifier runs against the current target branch merge-base instead of a stale webhook base SHA. A new failure is a technical error, not permission to skip classification. This is additive to existing CI, CodeQL, payout/payroll isolation and regulated release gates.

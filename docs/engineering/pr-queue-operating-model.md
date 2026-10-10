# Payroll PH PR Integration Queue

Status: engineering operating model, 2026-10-09. This supplements
`docs/engineering/change-risk-policy.md`. It is **not** release authorization.

## Goal

Stop accumulating half-integrated features. Keep all valid source work, but cap
**review-ready** work at three PRs across the repository. Other legitimate
features may remain draft; do not open more work in a release lane until its
current candidate passes the merge gate or is explicitly paused.

The queue is **read-only**; it does not auto-close drafts, auto-merge, approve
salary changes, apply SQL, turn on workers or enable payment providers.

## Three active reviews

Select up to three **independent** candidates, one owner and one relevant
independent reviewer per candidate. Before marking a PR ready:

1. Confirm the source SHA and current base and check the incremental diff.
2. Run exact-head CI, applicable security scans and domain-specific tests.
3. Name the lane and parent PR. Keep incomplete dependent work stacked as draft.
4. Confirm the requested independent reviewer is not the author.
5. Record staging/rollback requirements separately from merge acceptance.
6. Never resolve an unmet release gate by inventing reviewer approval, a
   migration receipt or employer/payroll acceptance.

The check in `.github/workflows/pr-integration-queue-gate.yml` fails the
**current review-ready PR** if more than three are review-ready at once. Drafts
do not consume a review slot. A failure is not permission to bypass the queue;
restore excess PRs to draft.

## Safe release trains

| Lane | Canonical dependency | Next review responsibility |
| --- | --- | --- |
| WFM correctness | #681, then #677, then stacked #683 | WFM domain/security, overnight/rest-day staging, scheduler OFF |
| HCM people lifecycle | #640 → #669 → #670 → #680 | HR access scope, maker/checker, historical evidence |
| Database + ESS | #667 → #673 → #682 | DBA/SQL journal, staged restore, employee identity/privacy |
| Payroll & finance | #668, #661, #666, #685 → #688 | Independent payroll reconciliation; payout and release activation separate |
| Position decisions | #648 | Effective-dated terms and HR/payroll downstream review |
| Scheduler security | #632, #679 | Two-worker staging, authorization, rollout switches OFF |
| SaaS subscription billing | #667 → #673 → #682 → #686 (`0106`) | Separate provider/security/DBA acceptance, no live-charge activation |

A dependency arrow shows **review/merge sequencing**, not approval or a
promise of feature parity. Keep a parent PR open until its code is reviewed and
merged. Close source PRs only when the canonical branch preserves every relevant
change with an independently checked diff and note on the closed PR.

## SQL reservation rule

SQL migration filenames share **one repository-wide append-only** sequence.
For example, #667 claims `0100–0103`; #673 follows with `0104`; #682
proposes `0105`. Billing #686 now follows this chain with `0106` on a stacked
branch. A future duplicate prefix is still a collision, even if it targets a
different table or a different PR branch.

The queue workflow inspects **incremental open-PR file lists** and flags the
later claimant of the same four-digit prefix; the existing SQL history guard
still checks per-branch consecutiveness, rename/edit behavior and main
history. These are source-level checks only. A qualified DBA must separately
verify the **actual applied journal, checksums, dependencies, staging backup
and restore** before any migration is executed.

**Do not solve migration collisions by blindly renaming a file or by merging an
old branch tree over current payroll code.** Integrate only the reviewed
incremental changes onto current main, compare full resulting files, rerun CI,
and leave any uncertain migration unreleased.

## Reviewer and release checklist

- [ ] Diff and dependency scope independently reviewed; reviewers recorded
- [ ] Exact-head applicable checks all green
- [ ] Risk tier (T0/T1/T2/T3) and rollback recorded
- [ ] No cross-tenant data leak, stale HR assignment or salary-history rewrite
- [ ] If WFM/payroll: golden and overnight/rest-day tests and reconciliation
- [ ] If schema/PII: DBA applied-journal and security/privacy sign-off
- [ ] If scheduler, AI, financial provider or live payments: default OFF and
      separate feature activation authorization
- [ ] If money movement: separate employer/bank authorization and recovery proof

## Workflow safety and limitations

The queue action uses `pull_request_target` but checks out **only trusted
default-branch source**, never PR-head code. Its temporary token has
`contents:read` and `pull-requests:read`. It makes no API writes, and the queue summary is printed to standard output
rather than writing untrusted GitHub API text to runner-owned files.
A GitHub API or pagination failure must fail closed, not silently return an empty queue.

This CI status prevents a merge **only if a repository administrator makes it a
required check in GitHub rulesets/branch protection**. The connector cannot
configure that administrative setting. After the independently reviewed
governance PR lands, configure the required check named
`Verify review WIP and SQL prefix reservations` for `main` and keep
existing CI, security, SQL and protected payroll checks required as appropriate.

Tracking: issue #674. A GitHub merge is never production payroll acceptance.

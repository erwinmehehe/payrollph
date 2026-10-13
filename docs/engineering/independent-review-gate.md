# P0-3 independent human source-review and pilot freeze gate

**Status:** source controls submitted; a live human reviewer has NOT been
appointed or recorded. The existing repository ruleset **Protect main**
(`24862793`) was inspected October 12, 2026 and is **disabled**, with zero
approvals and no required status checks. A workflow committed to this
repository is NOT a merge blocker until GitHub branch/ruleset protections are
enabled and enforced by a repository administrator.

## Policy for first-paying-customer readiness

- The existing PR Queue Gate continues to cap **review-ready PRs at 3**.
  Work exceeding the cap stays draft. Do not bulk-merge overlapping payroll,
  provider, schema, or payout PRs.
- For **T2/T3** changes and any payroll, pay run, payslip, separation/final
  pay, approval, bank, payout, encryption, migration, security or scheduler
  path, require approval from at least **one named human who is not the PR
  author**. This person must be explicitly allowlisted and hold GitHub
  `write`, `maintain` or `admin` collaborator permission. Bot, owner self
  review and unlisted approvals do not count. GitHub API reviews must have
  the exact latest PR head SHA. A later dismissal or changes-requested review
  fails the check; comments do not count as approval.
- Optional HCM, WFM, talent, Worker 360, compensation, performance, coverage
  and planning lanes remain **frozen** until a genuine documented first-pilot
  start is approved. Merely merging the source check does not lift this freeze.
  Core Payroll/People/Time bug fixes remain eligible for independent review.
- **Bounded pre-pilot core Time retention maintenance:** The reviewer-first
  selfie/photo-retention boundary defect can be submitted to *independent human
  source review* before optional WFM pilot activation, but only when a PR
  modifies exactly the four existing canonical retention/evidence code and
  regression-test files. No added/renamed/deleted/extra files qualify; a
  partial/no-test change remains frozen. The exception does **not** waive the
  named reviewer allowlist, contributor permission, exact-head `APPROVED`
  review, or passing checks. The PR author, maintainer self-review and bots
  still cannot approve it. This is a fix to the contradiction between the
  stated "core Time bug fixes" policy and the generic WFM filename freeze,
  **not** a pilot-start authorization and **not** permission to collect selfies.
  Any different pre-pilot WFM change requires a separately reviewed policy
  decision. The maintainer must review the actual diff, not merely filenames.
- Source approval is **not** employer payroll authorization, a bank release,
  encryption/migration acceptance, or production feature activation. Actual
  payroll continues to require separate employer maker/checker/releaser,
  company-level permissions, payroll reconciliation and explicit production
  release records.

## One-time human setup (administrator required)

1. **Appoint a named independent human** (GitHub username and release duty).
   The owner cannot name the assistant, an AI bot, a dummy account or themselves
   as an independent reviewer of their own PRs. Record the business role and
   backup reviewer in a restricted internal staff register. If no independent
   human is available, remain blocked; do not fabricate an approval.
2. Add a GitHub **repository variable** `PAYROLL_INDEPENDENT_REVIEWERS`
   containing one to ten comma-separated **real GitHub usernames**, e.g.
   `human-reviewer-1,human-reviewer-2` (replace examples, never use fake
   accounts). Grant them proper repo collaborator `write` or higher access,
   but avoid unnecessary admin/billing permissions. The enforcement worker
   fetches collaborator permission, verifies submitted GitHub reviews and
   excludes the PR author. Missing/inaccessible permissions fail closed.
3. Set `PILOT_HCM_WFM_STARTED=false` or leave it unset. Keep
   `PILOT_START_EVIDENCE_REF` empty until independent startup evidence is
   accepted. To lift the freeze, record the committee-approved first-pilot
   reference and set both variables to `true` and a properly formatted
   approval ID. **These variables are release indicators, not authenticated
   evidence**; the owner must retain signed underlying acceptance elsewhere.
4. Once this workflow has been reviewed, tested and merged, edit
   **Settings → Rules → Rulesets → Protect main**. Set `enforcement=active`
   on the default branch. Require PRs, at least one approving review,
   dismiss stale reviews on new commits, last-pusher approval, conversation
   resolution, and passing **current-head required checks**, including:
   `Require independent payroll change approval`, existing
   `Verify review WIP and SQL prefix reservations`, CI `check`, and
   applicable payroll/golden/security checks. Do not grant the owner a
   routine bypass; verify any break-glass route is logged/approved separately.
   The official GitHub settings are necessary because this connector lacks
   branch-protection administration access. A disabled ruleset is not a
   production-ready gate.
5. Configure the protected **production** GitHub environment with a second
   human approval, strict deployment branch restriction to `main`, and
   authorized release operators. Do not provide GitHub workflow secrets or
   financial data to PR-head builds, and never execute untrusted code in
   `pull_request_target`.
6. Witness a test pull request changing `src/lib/payroll-engine.ts`:
   self review, bot review, old-head review and missing allowlist must block;
   a permitted *different human* approving the exact latest SHA should pass.
   Verify a separate test WFM/HCM path stays blocked with the pilot flag OFF.
   Capture PR review URL, commit SHA, check run URL, ruleset screenshot/API
   proof, reviewer name and date (excluding private payroll/employee data).

## Implementation

- `.github/workflows/independent-payroll-review-gate.yml` uses
  `pull_request_target` and `pull_request_review` events but checks out
  **trusted main only**, with read-scoped GitHub token and no PR-head code.
- `scripts/check-independent-pr-review.mjs` reads the complete paginated
  file list and review history, verifies current SHA and known reviewers,
  and consults GitHub collaborator permissions. It writes no GitHub API
  state. API 403, stale events, missing data or pagination caps fail closed.
- `scripts/lib/independent-pr-review-policy.mjs` contains the pure
  classification/approval decisions; offline behavior and mock-API tests
  are in `tests/independent-pr-review-gate.test.mjs`.
- The existing `scripts/pr-queue-policy.mjs` and three-review-ready-PR
  limit remain unchanged.

**Never close P0-3** on code merge or an empty named-reviewer variable alone.
Require a real independent reviewer, an active main ruleset with enforced
checks, protected production environment and demonstrated behavior on a test
PR. Also do not treat a checked box as proof that any live employee was paid.

# Invitation acceptance GET/POST — source-current two-method proposal

**Scope:** Only GET and POST /api/invitations/accept. No changes to application handler, database schema, auth helpers, providers, jobs, flags, payroll or production.

The merged #1860 proof head `a58546ccfd6034b90191fd1ab72ca4ab6a45bd91` is an actual parent of main commit `b4b83872b46755872289b2fcbe34e2e8c37e6dba`. Exact route, auth/token/DB/audit/rate-limit dependencies, test fixtures, two PG16 production-mode localhost HTTP runners and CI workflows all have matching Git blob SHAs in current main. Both required workflow runs and jobs report completed success:

- **GET:** https://github.com/erwinmehehe/payrollph/actions/runs/42569443256/job/129003172669. Two distinct own bearer-token previews, real higher-ID victim, forged selector rejection, invalid/expired/redeemed tokens, no-store/no-referrer and SQL read-only invariants.
- **POST:** https://github.com/erwinmehehe/payrollph/actions/runs/42569443187/job/129003172379. Two independent account creations with scoped active-unit memberships, foreign/inactive unit rejection, ignored forged selector, one-use replay, CSRF and real audit-INSERT veto transaction rollback.

**Base count:** 498 methods = 447 COVERED / 11 PUBLIC / 40 GAP.
**Proposed count:** 498 methods = 449 COVERED / 11 PUBLIC / 38 GAP, subject to exact PR-head CI and independent security/privacy review.

The existing runner labels `coverageCredits: 0` refer only to its proof-execution role; separate source-pinned testable ledger promotion is proposed here. It does not assert production acceptance or independent security certification.

**Collision check:** Current four open PRs #1862 (account email), #1865 (CI), #1866 (public classification), #1869 (token-only operations) touch no invitation-acceptance app or proof family. Shared coverage manifest and inventories are intentionally modified to record the two credits; **merge will require a fresh main rebase/reconciliation** and preservation of every other PR's earned coverage. No auto-merge, production deployment, providers, money, remote DB or real users.

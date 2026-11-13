# Form 2316 SSR: historical legal-employer transfer and worker-existence proof

**Classification: SOLO_VERIFIED_DEV_RECOVERY CANDIDATE / NOT ACCEPTED.**
No new method or page/action coverage credit, production certification, or authorization to activate a feature is requested.

## Why a separate PR

Merged #1953 fixed a same-parent Form 2316 worker-existence oracle. The prior-employer worker fixture tests the initial denial, and the existing payroll tax page fixture covers basic selected worker/separation enforcement. Neither source-frozen preliminary proof automatically certifies the Form 2316 page after a worker transfers legal employers or after a previously authorized operator's grant is revoked.

This PR introduces **only** an isolated contract, a new synthetic PostgreSQL 16 real-HTTP runner, a focused negative unit test, a dedicated workflow and this note. It does **not** alter the page, BIR tax calculations, API, payroll, authentication, source-sealed historical proof, method manifest or CI evidence/credit writer.

## Guarded execution

Workflow: .github/workflows/tenant-2316-ssr-transfer-qa.yml.
Proof: scripts/qa/tenant-2316-ssr-transfer-http.mjs.
Contract: scripts/qa/tenant-2316-ssr-transfer-contract.mjs.

The contract checks exact runtime source Git blob SHAs, the existing manifest's GAP status and the disposable-only environment **before** any app/DB imports. Runner uses a fresh empty localhost postgres:16 database and production-mode Next built with multi-entity and unsigned 2316 draft flags enabled **for this synthetic test only**. No real users, government data, network providers, tokens, payouts, filings, payroll release, migrations against a live DB or deployments.

## What the real-HTTP proof must establish

- Three distinct fictional employers, distinct signed-in owners, and actual stored higher-ID victim organization/entity/employee/user records; two attackers and the genuine victim each demonstrate a populated own released Form 2316 SSR success and an authorized worker-only guidance response.
- A second legal employer exists **inside attacker A's organization**, with a genuinely persisted worker and released separation. A has no grant to that employer. Both worker-only and released-separation requests hard-404, as do a nonexistent worker and a forged owned separation paired with the other employer's worker.
- Both attackers are denied real foreign organizations, employees and separations. Noncanonical year/employee/separation IDs, duplicates, foreign selectors and unreleased separations cannot mount the private certificate page.
- An employee whose **current employer changes after a released separation** remains eligible for historical Form 2316 review under the original frozen employer grant. The same worker without a separation is denied because the caller lacks a grant to the employee's **new current employer**.
- Revoking the historical employer grant denies previously valid separation review without logging out the real session. Independently revoking active company membership also denies review while the session remains valid. A unit-scoped bookkeeper, anonymous caller and mismatched employer are not treated as permitted payroll operators.
- Snapshots of nine actual PostgreSQL tables (employers, legal entities, employees, grants, memberships, separations, year-end prior evidence, payroll runs, audit events) are compared before and after all own/denied GETs, including rebasing after intentional fixture transfer/revocation. No private victim markers, employee numbers or employer bindings may appear on denied SSR pages.

Every claim above is an **assertion to execute** in CI, not a passing test result merely because this PR was created. An actual green exact-head PostgreSQL 16 workflow and inspected logs are mandatory. The source-only unit test must reject fake-positive 200s, forged employer bindings and leaked private markers.

## What remains unaccepted after a green run

This is an additional **SSR read-boundary** proof. It does **not** exercise the hydrated client interactions, completed Form 2316 API source/PDF lifecycle, all historic tax reconciliation rules, or full end-to-end production privacy behavior. Existing dedicated BIR API and component proofs remain separate and must be reviewed together with an integrated browser/page-action test before the Form 2316 page can be considered for a COVERED credit.

Explicit acceptance gate:

1. Exact final PR-head synthetic PostgreSQL 16 build, workflow and relevant security tests green. Review all failure/skip counts, source pins and output; do not treat queued or failed jobs as passing.
2. Independent security, privacy and payroll-tax review, including historic frozen employer vs current employer behavior and complete client interaction/action boundary.
3. If and only if reviewers accept the **entire page/action surface**, separately propose a source-sealed page-credit reconciliation with a real receipt, zero duplicate credit, and no impact to unrelated API methods.
4. Keep the Form 2316 page GAP, pageActionCredits: 0, acceptanceStatus: NOT ACCEPTED and production/provider/money flags OFF in this PR.

Related: #1953 (merged fix); #1956 (open payroll-run oracle, no overlapping application files); #1952 and #1954 (open SSO/identity family, unrelated). Rebase and rerun against final main if these are merged first. This PR grants no authorization to merge or deploy by itself.

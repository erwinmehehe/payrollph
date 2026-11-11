# Tenant isolation: HCM Process Monitor and Hire-to-Payroll Input Review

**DRAFT — ZERO credits — NOT ACCEPTED for independent security, production, payroll release, or launch.**

## Scope

This independent, read-only proof batch covers two previously unverified private server-rendered pages on the reviewed `main` base:

- `/hcm/process-monitor?organizationId=...&processId=...` — company-wide authorized HCM process monitoring and steps.
- `/hcm/hire-payroll-review?organizationId=...&employeeId=...` — private employee onboarding and payroll-input **presence** review (not payroll approval).

These are **page/action evidence candidates**, not API-method promotions. Neither page performs approvals, payroll calculations, bank submission or worker provisioning. No shared method manifest, source inventory, runtime page, production route, schema, flag setting or provider implementation was altered.

## Reviewable implementation

- `scripts/qa/tenant-hcm-sensitive-pages-contract.mjs` checks reviewed source Git blobs, database filtering, safe localhost-only environment, actual response content, confidentiality and SQL immutability.
- `scripts/qa/tenant-hcm-sensitive-pages-http.mjs` starts only in the strictly gated disposable CI environment, requires PostgreSQL 16 and empty employer/user tables, and performs authenticated real HTTP reads against a locally built Next.js app.
- `tests/tenant-hcm-sensitive-pages-contract.test.mjs` includes negative controls for counterfeit successes, source drift, altered snapshots, leaked tenant markers, missing environment gates and provider variables.
- `.github/workflows/tenant-hcm-sensitive-pages-qa.yml` builds and runs the test with an ephemeral PostgreSQL 16 service, locked npm dependencies, artificial encryption keys, localhost-only web server and payout/providers/workers OFF.

## Evidence required on the final PR head

1. Seven fully populated fictional filler employers, two distinct authenticated employer owners and a third higher-ID real victim; actual persisted workers, two HCM processes with steps per tenant, HR/company/unit roles, and distinct source-private markers.
2. Two own-process reads per owner (in-progress and approved), two own-worker reviews per owner, plus a separately authenticated company-wide HR positive for each page. All success pages must render the real authorized IDs and meaningful status sections, not simply 200 or an empty/unavailable shell.
3. Cross-employer organization, process and worker ID substitutions must return denied pages without either employer's business data. Duplicate, malformed, exponent and missing selectors, invalid filters/cursors, anonymous readers, unit-scoped HR, and bookkeepers must not obtain the private pages.
4. The same owner session must survive a fictional organization-membership revocation, but both private SSR pages must then deny access.
5. Read-only snapshots of organizations, legal entities, units, membership, workers, pay profiles, provisioning tasks, process instances, steps, audit, payroll runs and payout batches must remain byte-identical for **all ten employers** during tested HTTP requests. Private bank, tax and process notes must never appear in HTML.
6. Exact checked-out PR-head job must pass, with source-pinning tests, main CI, CodeQL and applicable security checks. An independent security/privacy reviewer must examine the populated positives and foreign-denial source evidence before any proposed page-status promotion.

## Explicit exclusions and acceptance

- **ZERO credits** are applied to the API-method ledger or page/action inventory in this branch. The historical page GAPs remain until separate review and an accepted source-pinned evidence reconciliation.
- This runner does not certify a whole workflow, HCM approval, payroll preflight, employer identity in production, provider integrations, production deployments, taxes or compensation privacy across the full app.
- No live Neon access, migrations, real employee information, external services, feature activation, production deployment, payout, bank file, statutory filing or launch permission.
- The synthetic source run and its completion statement are engineering evidence only; independent security review and release gates are separate. **NOT ACCEPTED** until recorded, and no automatic merge is proposed.

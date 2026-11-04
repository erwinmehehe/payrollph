# ESS pay-explanation tenant boundary — isolated draft

## One disjoint API method

Target: `GET /api/self/payslips/[id]/explain`. A globally addressed entry ID was protected by the signed-in employee match, but the **previous payroll run** used only `organizationId`, released status and an earlier pay date. It could select an unrelated employee's run within the same organization, returning that run's metadata as `previousRun` even when no prior entry for the caller existed. The selected prior run and later prior-entry query were separate.

## Proposed safeguards

- Require a canonical positive safe-integer entry ID; invalid, missing and foreign IDs return the same private no-store 404.
- Keep authenticated employee role, active employer membership and released-run checks before payroll reads.
- When multi-entity is enabled, require explicit employee legal-employer attribution and constrain **both current and previous** released runs by it. Do not silently fall back to group-wide context.
- Select previous payroll entry and run in **one inner join**, filtered to the session's employee and organization. A colleague's earlier run cannot be shown or used for comparison.
- Keep existing feature-OFF historical legal-employer behavior and the response contract. Read only; no payroll writing, payment providers or migrations.
- Return private no-store for successful explanation data and uniform missing-resource errors.

## Validation and limitations

Focused parser and source-contract test: `npx tsx --test tests/self-pay-explanation-tenant-boundary.test.ts`. A passing source check is **not** tenant-boundary proof. Before any inventory promotion, run a disposable PostgreSQL 16 production Next localhost HTTP test using independent actual employee sessions, positive own-current/prior explanations, unrelated colleague prior run, higher-ID foreign and missing entry equality, revoked membership, two legal employers, multi-entity ON/OFF, and unchanged victim payroll/identity/audit SQL. Require passing exact-head CI plus independent security review.

**No provisional COVERED credit:** this method remains `GAP`. This PR does not touch the shared tenant-isolation coverage manifest or test gates and authorizes no production deploy, migration, provider, money movement or real-customer data.

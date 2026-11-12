# Hire-to-payroll review SSR: employer/worker binding

**Status: DRAFT / zero tenant-isolation coverage credits / not independently accepted.**
Independent from open PR #1886 (workspace readiness API) and PR #1887 (Worker 360 SSR). Branch starts from `main@75becb095ee209c88145c237a53afcb5b1e570e3`.

## Bounded problem and fix

The `/hcm/hire-payroll-review` page already checks a canonical employer selector, employee selector, feature allowlist, signed-in role, active employer membership, custom permission/session policy and company-wide scope. Its source loader also filters employee/pay-profile/onboarding data by both employer and employee.

However, when the loader threw, the page rendered an "unavailable" shell and employee-specific navigation without first proving that `employeeId` belonged to the employer. The rendered shell was not proof that the worker existed or that employee/pay data had leaked. It was an unverified worker context and should not be mounted.

This change adds one **minimal, read-only** `employees.id` existence query with both `employees.organizationId = organizationId` and `employees.id = employeeId`, strictly **after** the employer role/permission gate and **before** the loader, navigation or fallback. Foreign/nonexistent employee IDs return 404; an error in the existence query fails closed rather than rendering worker-specific UI. The original "source unavailable" message remains available only after the requested employer/worker pair has actually been verified.

No worker PII, statutory field, salary, payment data or document is selected in the new query. No API, schema, payroll calculation, provider, feature flag, membership policy, shared tenant coverage manifest or existing PR is changed.

## Local structural regression

- `npx tsx --test tests/hcm-hire-payroll-review.test.ts`
- `npm run typecheck`
- `npm run lint`
- Applicable security checks and normal CI must pass on the **final PR head**.

The added source-contract test checks the authorization-ordering, two-column SQL tenant/worker predicate, existence-only projection, 404 denial and that the binding query is not swallowed by the availability fallback. **A source-contract test is not a real HTTP/PG16 tenant-isolation proof.**

## Required before any merge or acceptance

- [ ] Execute an **exact-final-head**, locally isolated production-mode Next.js real-HTTP proof using an empty, disposable **PostgreSQL 16** database and fictional data only.
- [ ] For independent owners A and B, prove their own authorized worker pages render real read-only evidence, including a second real same-employer worker.
- [ ] For both owners, prove a real **higher-ID third-employer worker**, a swapped employee ID with otherwise authorized organization ID, nonexistent ID, duplicate/malformed selectors, anonymous, unit-only, incorrect role and revoked membership never mount private worker UI.
- [ ] Inject a source-loader failure for a **verified own** employee and confirm the unavailable fallback remains bounded. Inject a worker-existence query failure and confirm **no worker-specific HTML or navigation** is produced.
- [ ] Confirm immutable snapshots for every fictional employer's employee, payroll, profiles, provisioning, audit and authorization rows after every denied read; no provider or money operations are enabled.
- [ ] Complete fresh exact-head CI, security checks and **independent human security/HR privacy review**. Keep global tenant-isolation counts unchanged pending a separate acceptance decision.

No live/production/Neon access, migration, data write, external provider, payout, payroll release, deploy or merge is authorized by this draft.

## Legal-employer boundary follow-up (current proposal; zero credits)

The existing organization-plus-worker existence binding was not enough for a parent
organization with multiple legal employers. The selected worker may belong to a
legal employer that the authenticated HR actor was not granted. This is a
**source-identified latent boundary** behind the unchanged production
multi-entity HCM embargo, not an observed production exploit.

This follow-up resolves the single granted legal-employer context after active
company-wide HR authorization, rejects group/invalid/duplicated selections and
binds the first existence-only employee lookup to the selected legal employer.
It passes the resolved legal entity to the read-only source loader, which also
requires legal-employer matching and refuses missing legal-entity scope when
the multi-entity flag is enabled. The multi-entity-OFF legacy behavior remains
unchanged. Synthetic same-parent / two-legal-employer SQL test cases are added.

**Proof status: NOT ACCEPTED, zero new page/API credits.** Existing historical
PG16 proof passed against older source bytes and must not be counted for this
revision. Run both existing exact-head fictional PG16 HTTP workflows, complete
new multi-entity same-parent HTTP/browser coverage and independent HR/security
review. Parent-organization pay profiles and provisioning history require
separate legal-employer attribution review before any multi-entity HCM release.
Do not relax the HCM production embargo, activate flags, merge without review,
or treat this source hardening as payroll/financial acceptance.

# Employee Self-Service statutory and identity tenant isolation

**Scope:** four existing employee-only HTTP methods, without edits to the open Workforce, Compensation, Loan, People/platform or CI PRs.

| API method | Positive proof | Negative proof |
| --- | --- | --- |
| `GET /api/self/identifiers` | Signed-in linked employee reads an actual pending, masked identity change request | Independent employer reads only its own requests despite forged selectors; revoked former-employer session is rejected |
| `POST /api/self/identifiers` | Signed-in linked employee submits a synthetically valid ID for encrypted review and reads the persisted employer/employee binding | Forged `organizationId`, `employeeId`, and `requestedByUserId` never change the target; revoked member is rejected without a new request |
| `GET /api/self/contribution-issues` | Linked employee reads a genuinely persisted contribution issue with a unique marker | Two independent signed-in employers never see the victim marker; a former member retaining an otherwise valid session gets 403 |
| `POST /api/self/contribution-issues` | Linked employee creates a fictional case and proves its stored organization, employee and reporting user | Forged `organizationId`, `employeeId`, and `reportedByUserId` never change the target; revoked member is denied before creating any case, automation, email outbox or audit event |

## Source correction

`src/app/api/self/contribution-issues/route.ts` previously checked session identity and `employeeId` but did not check that the employee's **current employer** still had an active membership for that session user. The shared employee context now calls `assertMembership(user.id, employee.organizationId)` immediately after loading the employee and before either HTTP method reads or writes contribution evidence.

This is a **source-identified stale-membership gap**, not a claim of a confirmed production exploit. The identifiers endpoint already performs the active-membership check and remains unchanged.

## Guarded executable proof

`scripts/qa/tenant-ess-statutory-identity-http.mjs` runs at the end of the existing `tenant-second-pass-http.mjs` guarded job. It requires CI, explicit isolated mode, `http://127.0.0.1:3000`, `postgresql://...@127.0.0.1:5432/app_db`, ephemeral PII encryption and absence of real payment and email transport credentials. The insertion into the runner changes **no existing source line numbers**, protecting already-reviewed line-pinned evidence.

The suite creates three independent fictional employees, one per employer, and submits an actual identifier request and contribution case for each. It tests two independent attackers, genuine victim-only employee IDs greater than six, populated own-response evidence, forged owner/employee selectors, and unchanged victim records after every denial or forged write. The victim's employee session is then given a separate active employer membership; the original employer membership is revoked while preserving that **same authenticated session**. Both GET and POST methods must return 403 for the old employer. Victim case, event, encrypted identifier, compliance task, audit and outbox PostgreSQL snapshots must be byte-for-byte unchanged.

The `tests/tenant-ess-statutory-identity-source.test.mjs` test checks the source guard, exact method inventory, fixture restraints, and executable runner wiring. Static/source checks alone **do not** count as actual cross-employer HTTP acceptance.

## Limits and review

- The case proof exercises the ordinary synthetic employee-reporting branch; it does not certify every remittance member linkage, agency/provider integration, or notification delivery.
- The identifier proof covers the pending review request and masked read, **not** administrative approval or statutory ID verification.
- No production database, SQL migration, live employee, provider credential, payment transfer, external email or feature flag is modified.
- Do not mark manifest methods `COVERED` or change release-readiness totals until the **exact-head** real HTTP/PG16 security-smoke run passes and an independent reviewer verifies the evidence and source links. No systemwide tenant-isolation closure or production authorization is implied.

**Review requirement:** CI regression, required security HTTP smoke, payroll/security gates, CodeQL and independent security review on this branch. The PR must remain unmerged until these are green.

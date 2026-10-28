# Workforce Planning Allocations: independent POST tenant-isolation proof

**Status:** DRAFT / NOT ACCEPTED / 0 coverage credits / do not auto-merge.

**Exact authoritative GAP:** `POST workforce-planning/allocations` in `scripts/qa/tenant-isolation-coverage-manifest.json`.

## Independence

This batch targets Workforce Planning Allocations, not the open Invitations,
Careers, ESS Documents, Leave, HMO Benefits, Performance Governance, payroll
overpayment, Automation Studio or Attendance PR families. Only five dedicated
QA, workflow and documentation files are added. The production handler,
authorization and billing code, migrations, provider integrations, feature
flags, global tenant catalog, coverage manifest and reservation ledger remain
unchanged.

## Executable evidence

A dedicated PR-only GitHub Actions workflow runs fresh empty PostgreSQL 16 on
`127.0.0.1:5432/app_db` and a real production-mode Next server bound to
`127.0.0.1:3000`. Fail-closed preflight checks are executed **before
importing database or application modules**. Workers and scheduler are off,
disbursements are disabled, provider credentials are absent and Enterprise
plan gating is not activated. A reserved `*.example.test` origin is metadata,
not an external network endpoint. All logins, owners, employees, plans,
allocations and manager requests are fictional and created in the test DB.

The runner creates two independent owner attackers A/B and a victim C with
strictly higher *real persisted* organization, workforce-plan, org-unit and
allocation IDs. Each employer has its own plan, a populated previously saved
top-down allocation, a second genuine active department and an employee
without administrator permissions.

**Before writes:** Three owner GETs must return populated, exact own plan
allocations. Employer A's real successful response must *fail* employer B's
positive assertion, preventing a vacuous 200 from counting as proof.

**Attacker denials:** Both A/B attempt the victim's actual employer GET (403),
POST allocation for victim (403), POST manager request for victim (403), a
victim plan under their own employer (404), a victim unit under their own
plan (404), a real victim allocation ID under their own employer (404),
own-employer GET and POST as a non-admin employee (403), and overspending
their own plan's budget (409). No victim marker may appear. After each
attacker's attempted operations, all three employers' real business and
audit state must remain unchanged.

**Authorized positive mutations:** Each owner must create its own second
department's allocation (201) and then a related manager draft (201).
All six HTTP responses must identify *actually inserted* DB rows and
correct employer/plan/unit/creator IDs, budgets, request version, saved
allocation evidence and notes. Each insert must have exactly one
actor-attributed audit event with the expected action and metadata.
After every write, protected tables for the other two employers must
be byte-for-byte semantically unchanged. Employees, pay profiles,
financial payroll runs, attendance punches, plans and unrelated planning
records must never change. Audit-chain cryptographic seal columns alone
are normalized for comparison.

## Limitations and gates

The already-covered GET is a populated positive control only. The POST
proof currently exercises both `entityType=allocation` (create) and
`entityType=submission` (draft), but does not cover allocation update,
revisions, all budget-race scenarios, or PATCH accept/reject/submit actions.
Therefore **the entire POST method remains GAP** until independent review
and any remaining coverage conditions are met.

- [ ] Exact PR-head source-contract and negative-control tests pass
- [ ] Exact PR-head disposable PG16 + real HTTP proofs pass
- [ ] Exact PR-head required CI and security checks pass
- [ ] Independent maintainer/security review accepts source-specific proof
- [ ] Separate reviewed method-level credit reconciliation (if warranted)

No production deployment, money movement, schema modification, payroll
authorization or global coverage increment is requested.

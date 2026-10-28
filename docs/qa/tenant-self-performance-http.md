# Employee self-performance: three provisional API method recovery candidates

**Scope:** GET, POST and PATCH /api/self/performance.

**Canonical status at branch creation:** All **3 API methods are GAP** in the checked-in tenant-isolation coverage manifest, with exact route blob SHA b85a8c7cbc40512c3d77da503c744ac7eb5748dd. No open PR claimed these methods or the dedicated files at selection on 2026-10-28.

**Status: DRAFT / ZERO CANONICAL CREDITS / NOT SECURITY-ACCEPTED.** This is an evidence-producing PR, not a direct coverage-ledger promotion. It does not edit scripts/qa/tenant-isolation-coverage-manifest.json while PR #1509 reconciles different methods.

## One method = four independent proof requirements

| Method | Genuine own positive | Genuine foreign and same-employer negative | Frozen victim and financial source | Forgery and role protection |
|---|---|---|---|---|
| GET | A, B, victim and coworkers return **nonempty** cycle/review/items/goal/meeting/action/feedback with exact persisted IDs | Session-linked employees see only their own rows; no victim, other employer, peer or private manager data | Compare actual employer HR, personnel, pay profile, payroll, outbox and audit SQL snapshots | Query-string organizationId, employeeId, reviewId and oneOnOneId ignored; forged stolen employee identity, owner and revoked membership denied |
| POST | A and B each create a real **201** 1:1 agenda contribution with persisted author and exactly one audit | A/B cannot create against real higher-ID victim or other attacker/coworker 1:1 (**404**) | Own write must not alter other employers, peer, review or payroll; exact new agenda and audit checked | Forged JSON organization/employee/author selectors ignored; owner, anonymous, revoked and completed meeting denied |
| PATCH | A and B submit and **update** self-assessment with exactly one required competency item, persisted scores/reflection and actor-bound audit | A/B cannot modify real higher-ID victim, other attacker or coworker review (**404**); a foreign competency ID against an owned review fails (**400**) | Exact review/item writes and single audit; every other worker, employer and payroll row unchanged | Forged JSON employer/employee/cycle selectors ignored; invalid score, owner, anonymous, revoked and completed review denied |

Every employer has a real review, a competency item joined to real template and cycle-template rows, a goal, scheduled 1:1, initial agenda, shared/private action item and shared/private feedback. No empty-list 200, guessed IDs, unrelated 401, generic 404 or provider-disabled 501 may be mistaken for successful method proof.

## Isolation and safety

- New PostgreSQL 16 app_db service and Next production-mode localhost 127.0.0.1:3000, with a guard executed before database imports.
- Two independent fictional attacker employers, a victim employer seeded last so all victim org, worker, meeting, review and competency IDs are genuinely higher, and same-employer peers.
- Synthetic sessions mapped to actual employee records and active memberships. Real SQL persistence, audit author attribution and absence of collateral changes are mandatory.
- No production routes, migrations, schemas, live records, real employees, money movement or real email delivery. Hosted environments, provider keys, payout workers, billing and scheduler are refused.
- Independent unit suite deliberately corrupts successful/denied responses, environment safeguards and audit evidence to ensure tests fail closed.
- PR-only CI executes unit tests, npm run db:push, isolated audit schema baseline, actual production-mode Next and PostgreSQL-backed HTTP integration.
- No global tenant-isolation claim, no automatic method status promotion. Source-only proof is not the real HTTP + unchanged-victim acceptance evidence.

## Candidate credit gate

**Up to three newly coverable method records, not three recovered credits yet.** A separate review of exact-head passing workflow evidence, current-route SHA, method completeness and independent security owner approval is required before changing any manifest statuses. Reconcile with coverage-promotion PR #1509 and concurrent main changes to avoid double counting.

Required before promotion: exact-head dedicated PG16/HTTP passing own GET, POST and PATCH including negative checks; exact-head CI, Security HTTP Smoke and CodeQL; independent review of both attackers, victim/no-leak and unchanged payroll/audit evidence; then a separately reviewed manifest edit with distinct method-specific line pins.

Keep system-wide acceptance **NOT ACCEPTED**, leave this PR draft and do not auto-merge. No production rollout.

# Tenant authorization — flagged 34, first delegated-trace and manifest-driven evidence

**Status:** Work in progress; no production probing. This file is a triage guide, not a certification. The current source-pinned inventory covers 489 methods in 288 route files; #1260 is merged. **The #1290 integrated synthetic evidence baseline has 434 provisional API GAPs and 20 scoped page/action GAPs. Neither static traces nor probes certify those gaps.**

## How to reproduce (disposable PostgreSQL only)

The existing `.github/workflows/security-http-smoke.yml` boots ephemeral PostgreSQL 16, builds production Next.js and runs `scripts/qa/tenant-second-pass-http.mjs` with three distinct fictional employers and two independent attacker sessions. The new `scripts/qa/tenant-manifest-driven-http.mjs` reads **all 489** method rows from `scripts/qa/tenant-isolation-coverage-manifest.json`, filters real `GAP` methods and executes table-driven **family adapters** only where seeded positive records and exact expected foreign denial have been implemented. The runner emits the remaining unadapted GAP count. No blank-body 401 or invented ID counts as proof.

The `scripts/qa/tenant-delegated-trace.mjs` program parses source ASTs and follows local and `@/lib` helper function calls up to depth three for **all 34** flagged route files. It reports discovered access-gate call chains and unresolved candidates, but **never changes `GAP` to `COVERED` merely because a helper name looks safe**. The structural guard checks all 489 handlers for DB call paths and access signals. Existing unguarded methods are grandfathered **only at their exact source Git blob SHA**, using the manifest's explicit unresolved-`GAP` reason, never labeled safe; the existing source/route drift test fails new or changed handlers without proof or reviewed public rationale. A new route cannot silently bypass either inventory. AST checks are conservative signals, not path-sensitive authorization verification.

## Source-trace leads — 34 flagged route files

| # | Route | Source follow-up / delegated boundary | Evidence still needed |
|---:|---|---|---|
| 1 | `approvals/[id]` | `assertMembership`, `resolveMultiEntityContext`, unit scope and independent approval decision | Real task/foreign task ID plus unchanged approval state |
| 2 | `careers` | Public published-vacancy predicate; applicant privacy consent and protected intake proof | Public published-only listing, foreign requisition application denial |
| 3 | `compliance/bir-1601c-remittances` | Local `requirePayrollOperator` -> `getAccess` with company-wide payroll role; entity-scoped queries | Real own legal entity vs victim organization GET, separate POST |
| 4 | `compliance/contribution-issues/evidence` | `getAccess` company-wide payroll check and organization-filtered case/entry/evidence joins | Real existing foreign case ID and generated evidence bytes |
| 5 | `compliance/contribution-issues` | Local `requirePayrollOperator` -> role/company-wide scope; entity scoped reads | Real own/victim issue cases and safe POST |
| 6 | `compliance/government-loan-remittances` | Local `requirePayrollOperator` -> role/company-wide scope, resolved legal employer | Real own legal entity/victim GET; separate POST |
| 7 | `compliance/remittance-actions` | Local `requirePayrollOperator` -> `getAccess`/company-wide role; task org filtering | Seeded actual compliance action and victim task |
| 8 | `compliance/statutory-remittance-corrections` | Local requester/approver role helpers, sensitive MFA and correction predicates | Independent actors, pre/post DB, no official filing |
| 9 | `compliance/statutory-remittances/payment-evidence/[id]` | `getAccess` payroll role + exact `organizationId` SQL filter + SHA-256 byte integrity | Own PDF bytes; real victim high ID 404 and forged org 403 |
| 10 | `compliance/statutory-remittances/payment-evidence` | Local payroll operator -> access role/company-wide, indexed evidence query | Real own evidence listing and cross-org denial |
| 11 | `compliance/statutory-remittances/posting-import` | Public/nondata GET vs POST with payroll operator and sensitive MFA | Method-specific tests; real employer batch ID |
| 12 | `compliance/statutory-remittances` | Local payroll operator -> `getAccess`, resolved legal entity | Real own batch vs victim GET; separate POST |
| 13 | `dashboard` | `assertMembership` + `getAccess`; already method-level tested in inventory | Retain earlier evidence and source fingerprint |
| 14 | `employee-vault` | `authorizeEmployeeVault` -> `assertMembership`, `getAccess`, real employee org join | Feature-on synthetic real employee documents and revoke |
| 15 | `first-payroll/progress` | `assertMembership` + `getAccess`; journey helpers | Feature-appropriate own positive and victim denied mutation |
| 16 | `hcm/org-explorer` | HCM explorer access helper plus server-side loader | Real employee/position resource ownership, entitlements |
| 17 | `hcm/position-history` | HCM explorer access helper and history loader | Existing foreign worker/position ID denied |
| 18 | `jobs/admin-status` | `assertMembership` + `getAccess`; already in prior inventory | Retain earlier evidence |
| 19 | `leave` | `assertMembership`, `getAccess`, scoped employee requests and schedule | Actual own/victim leave ID; POST victim DB unchanged |
| 20 | `multi-entity/context` | `resolveMultiEntityContext` -> company grants; preference write | Feature-on group/member own/foreign preference tests |
| 21 | `multi-entity/reports` | `resolveMultiEntityContext`, group-report permission | Group vs individual entity reports, leak-free totals |
| 22 | `multi-entity/transfers` | `resolveMultiEntityContext`, entity resource checks and MFA | Genuine legal-entity transfer mutations with reversal |
| 23 | `organizations` | `assertMembership`, `getAccess`, MFA on privileged mutation | Actual own organization update and immutable victim |
| 24 | `payout-destination-changes/[id]` | `authorizeAssignedTreasuryOperator` -> tenant-scoped `getAccess`; `decidePayoutDestinationChange` checks org ID in SQL | Own pending destination request, different reviewer, victim 404; no payout |
| 25 | `payroll-runs/[id]/payout-reconciliation` | `authorizeTreasuryOperation`, organization-unit access, lock and provider safety | Safe read + dry-run/reconciliation role tests only |
| 26 | `report-builder/saved` | Local `authorized` -> `assertMembership`; id AND org AND user in SQL | Feature-on saved definition read/write and victim immutability |
| 27 | `v1/journal-entries` | `authorizeExtendedV1Read` -> scoped API-key authorization | Real key own Released journal; foreign key and ID denial |
| 28 | `web-bundy/consent` | Employee session + `assertMembership`; employer-scoped photo consent | Feature-on employee role, revoke and cross-org denial |
| 29 | `web-bundy/evidence` | Local `employeeSession` -> `assertMembership` AND employee's employer ID | Feature-on own clock/photo proof vs victim and revoked membership |
| 30 | `webhooks/paymongo/transfers` | HMAC signature + provider business/object lookup; no employee session by design | Signed simulated provider callback, replay and foreign mapping |
| 31 | `workforce/demand-observations/issued` | `getAccess` + `operationalDemandSiteAuthorized` org/worksite intersection | Real site/receipt foreign denial |
| 32 | `workforce/demand-observations/issued/score` | `getAccess`, independent site scope and MFA | Seeded score mutation, victim DB unchanged |
| 33 | `workforce/demand-observations/outlook` | `getAccess`, site authorization and operational demand loader | Real own/victim site read |
| 34 | `workforce/demand-outlook` | `getAccess` + `authorizedOutlookSite` | Actual scoped worksite/forecast and cross-employer denial |

**Security incident rule:** A genuine unauthorized disclosure or money mutation on a real production deployment is a stop-and-notify condition. This batch does **not** access production. Any reproducible leak found in *disposable* CI must fail the build, retain fictional reproducible evidence and get a code fix plus regression **in the same PR**, rather than being reported as a passed GAP.

## First six registered real-HTTP methods

The family-adapter registry currently contains the two statutory **payment-evidence file/list GETs**, **remittance-actions GET**, **BIR 1601-C GET**, **government loan remittances GET**, and **statutory remittances GET**. It creates eight victim-only real remittance batches, eight downloadable fictional payment proofs and eight compliance tasks so object IDs really exist and exceed 6. A and B each get a real own batch, file and task, an authenticated positive result, explicit foreign-employer 403, and exact **404** when a real foreign document ID is submitted under the caller's legitimate employer. No actual provider, payroll release, wage change or agency event is triggered. Pre/post victim snapshots cover evidence, tasks, employees, payroll, legal entities and audit rows.

**After #1290's independently recorded synthetic GET/POST evidence is integrated:** 55 methods are provisionally COVERED and 428 remain GAP. Of these six adapters, BIR 1601-C GET already has earlier HTTP coverage; it remains an extra regression, so **five** of the six are newly targeted GAPs.

**New integrated branch status remains PENDING until exact-head `Security HTTP Smoke`, the required CI `check`, CodeQL and payout-isolation checks pass.** No `COVERED` statuses, source SHA inventory, or counts have been changed in this batch.

## 20 page/action GAPs: remain open and source-pinned

The inventory includes all 20 page paths and their business-ID references. The new AST/source guard rechecks **all 20** exact source blobs and refuses an unreviewed page change. This is **not** equivalent to rendered/interactive HTML security validation. Each page still requires same authenticated employer load, real foreign-employer navigation, no private HTML/server-action data, and DB immutability for actions. Public careers is a separate published-only boundary. Feature-disabled responses are **not** valid authorized-positive evidence. Until runnable, page-specific test adapters exist, their statuses stay `GAP`; no blanket waiver.

## Next risk batches

1. Remaining evidence and files: bank-validations, BIR 2316 and filing proofs, foreign contribution-case evidence.
2. Money/approval mutations: pending payout destinations, payroll release/reconciliation, approval tasks, loans, compensation and billing. Use maker/checker + same-session MFA fixtures, disabled external provider endpoints, and exact DB snapshots. No sending money or agency files.
3. HR-case/employee-vault personal data, remaining statutory and all pages/actions.
4. Workforce, performance, planning and the remaining API families, with exact manifest-driven adapters.

The 428 API and 20 page/action coverage gaps are **unverified evidence gaps, not 448 confirmed vulnerabilities**. Source-level helper traces are not independent runtime proof.

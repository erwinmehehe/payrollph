# Employee Self-Service document and policy read — independent tenant evidence

**Method:** GET /api/self/documents, authoritative **GAP**. The separate POST
acknowledgement method already has a provisional **COVERED** record and is
not changed or credited again. This branch changes no application endpoint
or generated coverage manifest.

## Collision and release boundaries

At selection there were ten open pull requests, none targeting the ESS
document/policy read family. Separate drafts covered offline punch writes,
performance governance, benefits/HMO, development plans, leave preview, ESS
identifiers, API v1 journal and HCM skills, plus unrelated UI and HCM date
fixes. All paths in this PR are newly created, not shared test hooks used
by those branches.

This is a **standalone** disposable PG16/localhost HTTP witness, rather than
enabling the full existing DL-02 multi-family suite or repinning its cited
POST/other-family proof lines.

## Exact fictional test contract

- Create real PostgreSQL employers A and B and then a real higher-ID victim;
  all three have independently authenticated employee sessions, a real
  published employee handbook, assigned own policy, active document
  requirement, scanned metadata row, and linked compliance record.
- Include separate same-employer coworker records and document IDs. Real
  employee GET 200 must return precisely its own persisted employee identity,
  policy assignment/content and document-compliance metadata, not a blank 200
  or a same-employer peer's records.
- Create **real attacker-owned malformed ID-only foreign-key links** to
  a victim policy, victim document requirement, and victim document.
  GET must exclude foreign policy content/requirements and must not expose
  the foreign filename/metadata. A different coworker's real document ID
  attached to the employee's compliance must also produce null metadata.
  These rows are intentionally synthetic corrupt fixtures to exercise the
  legacy joins, not supported user actions.
- Both attacker sessions also supply forged victim organizationId,
  employeeId, policyId and documentId as query parameters. Since the route
  is session-scoped, an own-only 200 remains valid only if the exact own data
  contract passes and no victim marker leaks.
- An actual attacker-A HTTP response must **fail** attacker B's own-data
  contract, proving that the positive assertion is tenant-discriminating.
- Unauthenticated reads require 401; owner or unlinked employee sessions
  require 403. The victim's employee account gains a separate active
  second-employer membership and then loses membership in its original
  employer. **The same still-authenticated session** must receive 403
  from the original employee-documents GET.
- Exact before/after SQL snapshots of all three organizations, workers,
  policies, assignments, requirements, compliance, document metadata,
  payroll runs and audit must remain unchanged by every GET. The deliberate
  active-membership revoke is excluded from the business-data snapshot.
- Fail-closed pure contract tests reject fake successes, substituted
  policies and document IDs, cross-employer/coworker metadata leaks,
  unexpected extra rows, inaccurate summaries, and leaking denial bodies
  or headers.

## Safety and execution

- The dedicated workflow uses PostgreSQL **16**, a production-mode Next
  server on **127.0.0.1:3000**, fictional session cookies, temporary database
  and ephemeral encryption keys.
- Runner refuses execution without exact CI, disposable database, server
  and family opt-in flags, disabled payouts and absent real provider secrets.
- No customer files, S3 operations, external scanner, banking, payroll
  release, government filing or money movement is exercised.
- This verifies the GET read boundary only. It does not certify document
  uploads, HR decisions, policy write acknowledgements, all ESS actions,
  or independent full-product tenant readiness.
- The route is force-dynamic. The proof refuses explicitly public cache
  directives but does not claim a separate complete cache/CDN audit.

## Acceptance gates

- [ ] Exact PR-head syntax checks and all seventeen contract regressions pass.
- [ ] Exact PR-head dedicated PG16 / real authenticated localhost HTTP job passes.
- [ ] Applicable CI, CodeQL, security HTTP smoke and tenant inventory guards pass.
- [ ] Security reviewer verifies real SQL object IDs, negative-case HTTP status,
      poisoned joins, same-employer peer exclusion and unchanged victim data.
- [ ] If accepted, method-level source-pinned proof may be reconciled
      separately into the canonical inventory. **No credit in this PR.**

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO NEW CREDITS.** Staging, production
activation and payroll/money release remain separately gated.

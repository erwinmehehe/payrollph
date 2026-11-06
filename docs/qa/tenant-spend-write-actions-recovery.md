# Spend POST and PATCH tenant isolation: full-action fictional PG16 proof

**Draft, zero API method coverage credits, no production approval.**

## Unrelated scope
This is the Spend/expense-report family only, independent of the year-end, SAML, managed payroll, developer, and TOTP pull requests. No application runtime, tenant-isolation ledger, or production release flag is changed.

Target methods:
- POST /api/spend: category_policy, card, transaction, report.
- PATCH /api/spend: independently approved and rejected report decisions.

GET /api/spend already has a **separate provisional own/foreign PG16 proof** and stays untouched. POST and PATCH remain GAP and testedBy:null.

## Real HTTP proof candidates
The new harness runs production-mode Next on local 127.0.0.1 with three distinct, fictional PostgreSQL 16 employers. Two independently authenticated owner sessions exercise the following for their own workspaces:

- Successful category review with the actor ID bound to the current owner, not request-supplied fields.
- Successful company-card metadata registration and transaction recording, not actual card charging.
- Successful expense report submission with claims owned by the exact employee.
- Successful independent approval of a reviewed report with fictional, synthetic receipt-evidence rows.
- Successful rejection of another pending report.
- Active maker account denied its own report decision.

For each attacker, a real, populated higher-ID victim is used in denied requests:
- Foreign organization ID attempts for policy, card, charge and report actions.
- Forged victim employee, card and claim IDs while claiming the owned organization.
- Foreign report decision by path/row ID and forged organization selector.
- State checks for both the foreign victim and the other independent employer, including cards, charges, policies, claims, scanned-receipt metadata, reports, links and audit history.

The preflight explicitly rejects production database URLs, external provider secrets, workers, payouts, disbursements, live storage credentials and non-local HTTP. The receipts and merchant charges are **synthetic metadata only**; there is no object-storage call, real scan, employer payroll write, payout, or provider call.

## Recovery gate
1. All changed-file source-contract tests, the full two-attacker synthetic PG16 HTTP run, broader CI, and exact final-head security checks must succeed. Observe the workflow receipts, not just static source assertions.
2. Independent security, privacy, expense-policy and payroll review must assess the complete action matrix, including approved/rejected decision behavior, owner role checks, the missing real receipt-storage lifecycle and the former GET credit.
3. Only after accepted exact-source proof can a **separate ledger-only PR** consider crediting POST and PATCH individually. Do not count success from a single card action as proof of POST, or only rejection as proof of PATCH.
4. Until then both methods remain GAP. No actual money movement, real tenant data, deployment, feature activation, global tenant isolation certification or release authorization.

Test receipt selection: .github/workflows/tenant-spend-write-actions-http.yml
Harness: scripts/qa/tenant-spend-write-actions-http.mjs
Contract: tests/tenant-spend-full-method-candidate.test.mjs

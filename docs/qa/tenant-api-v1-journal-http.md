# API v1 Accounting Journal — separate tenant isolation GAP candidate

**Method:** `GET v1/journal-entries` — status **GAP**, zero new coverage credits.

**Base:** `main@318d6446ed371649982f76bb7c4ec9f57ff874fb`. At selection the current open PRs covered HCM manager attestations, account/session identity, Workforce Demand Governance and Year-End reporting. Concurrent HCM/Loans PRs were also checked; none targets this API-key journal method or its proof files.

## Actual scope and controls

This family is **bearer-key and legal-employer scoped**, not a browser-session GET. It exports a CSV journal from persisted **Released** payroll runs and writes an employer-specific audit event on success. The PR adds no application code, database schema, migrations, production flags or money movement.

The dedicated GitHub Actions workflow enables both `PUBLIC_API_V1_EXTENDED_ENABLED` and `API_V1_EXTENDED_READS_ENABLED` **only** against disposable PostgreSQL 16 and a production-mode localhost Next server. All bearer secrets are minted within the runner, used only as HTTP request headers and never printed.

The runner begins with an empty organization/audit database and seeds attacker A, attacker B, and a **real higher-ID victim**. It inserts three genuine fictional employers, legal entities, workers, owners, API keys and Released payroll IDs. Each employer has one in-range Released payroll run with a unique period marker and distinct gross/net centavos; it also has a Draft run in-range and a Released run outside the selected date range.

## Expected real PostgreSQL and HTTP evidence

- **Own token GET: 200 CSV** with exactly three balanced rows (debit payroll expense; credit deductions; credit net-payable) tied to its own persisted run ID, legal entity, period marker, pay date and exact centavos. Each positive response must create one matching PostgreSQL export-audit event.
- A's actual authorized response must **fail** B's proof and vice versa; an empty/default CSV cannot count.
- An attacker token plus the **victim's actual legalEntityId** (or the other attacker's) must return **403**, no CSV and no new export audit.
- An attacker token plus `organizationId=victim` and the attacker's own legal entity must still return **only the attacker's own** CSV: the untrusted query parameter must not become authorization.
- Missing/unrecognized token: **401**; token without `payroll:read`: **403**; invalid date: **400**; revoked previously used token: **401**. None may export or record an export audit.
- Adding a **second real legal entity** to an attacker's organization must turn the previously authorized tenant-wide token into **409**; there is no implicit group-wide token.
- Any victim/peer marker, Draft/out-of-window source, token, wrong amount, unbalanced/missing/extra CSV line or changed source payroll record fails.
- All three employers' payroll-source rows must remain unchanged; the higher-ID victim's API keys, full organization/employee/entity/audit/recovery snapshot and export audit must remain untouched.

## Important limitations

- Source Released records are **directly seeded fictional fixtures**, not evidence that a real payroll-release approval or provider settlement happened.
- The route is read-only except for its successful export-audit and API-key last-used writes. This test does not cover API key issuance UI, independent payroll approval, actual employee payments, banking, downstream accounting posting, withholding remittances or other API v1 methods.
- This is an isolated script/workflow rather than a new shared signed-in tenant-table row because the table runner cannot authenticate via bearer API keys or validate CSV and export-audit effects.

## Mandatory gates before credit or merge

- [ ] Exact-head `node --check` for both scripts and all eight source tests.
- [ ] Dedicated real PostgreSQL 16 / production-mode localhost HTTP workflow passes its assertions, including denial and victim immutability.
- [ ] Full CI, CodeQL, security smoke and GAP factory complete; investigate any failures.
- [ ] Independent security review accepts the actual exact-head logs and tenant/legal-entity/source proof.
- [ ] Separate manifest reconciliation before changing the method from GAP.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO COVERAGE CREDITS.** No live payroll readiness or global tenant isolation certification is implied.

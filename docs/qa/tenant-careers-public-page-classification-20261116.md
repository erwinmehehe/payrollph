# Careers page public classification — review and acceptance handoff

**Scope:** `src/app/careers/page.tsx` ONLY. Proposed on 2026-11-16 against the existing owner-approved 2026-11-09 anonymous public Careers API boundary. No application runtime or API-method changes. This is a source-level classification candidate, not an independent security verdict or production approval.

## Why PUBLIC-BY-DESIGN, not COVERED

The applicant-facing Careers board is deliberately anonymous. A signed-in employer-A user's access rights do **not** dictate whether they may see employer B's intentionally published vacancies. It would be a false tenant-isolation test to demand 403 for a legitimate anonymous visitor.

The permitted public response is the explicitly selected employer's name and at most 60 `careers_published=true` requisitions with status `open` or `interviewing`, attached to an `open` position within the same employer, projecting only `id`, `title`, `department`, `description`, `employmentType`. Do not expose applicant contact/consent records, worker IDs, payroll, pay amounts, bank details, drafts or unpublished/closed roles. The selection must be a single canonical, safe positive integer and require the configured privacy notice and schema-readiness guards **before** employer or requisition SQL. No source changes are proposed to these protections.

## Source-pinned existing proof and new classification guard

- Public page source: `src/app/careers/page.tsx`, blob `8e56412c909b7d70a5c33a21d3df52a79a693d4f`
- Original uncredited page proof: `scripts/qa/tenant-careers-page-public-boundary-http.mjs`, blob `6efef6eb6965d1deba1fe8d64446936a09553813`
- Existing isolated HTTP workflow: `.github/workflows/tenant-edg01-careers-public-get-http.yml`, blob `c9f89477a1e013d3ae4c7c50b1d737df1d257269`
- Source owner approval is already attached to both `GET /api/careers` and `POST /api/careers` as PUBLIC-BY-DESIGN (`approvedOn=2026-11-09`); no new API credit.
- Historical `GAP` reason and `reviewedUncertified` evidence remain intact. The new classification module reconstructs the exact historical 1-page-GAP view for sealed five-, six-, and four-page validators. It refuses fake private `COVERED` credits, changed source, altered proof/workflow or invented independent acceptance.

The existing three-employer fictional PG16 workflow must pass again on this PR's final head. It performs actual anonymous localhost GET/SSR positive publication checks, unpublished job refusal, duplicated/malformed employer selector refusals, no employer crossover and unchanged applicant/employee/payroll/audit SQL snapshots. A previous source head passing is a **historical input**, not final-head proof.

## Acceptance and remaining gates

- [ ] Exact current-head EDG-01 PG16 publish/unpublish + API GET + page SSR workflow passes in its entirety.
- [ ] Baseline CI, CodeQL, security HTTP and source-pinned page-coverage inventories pass on the **same PR head**. If any fail, the classification candidate must remain unmerged; do not rewrite a receipt to bypass a failure.
- [ ] Maintainer reviews proof authenticity, anonymous/public design, source hashing, and compatibility with historical ledger assertions.
- [ ] Independent security and recruitment/HR privacy reviewer records their separate findings before stating tenant-security acceptance.
- [ ] If a genuine private applicant or cross-employer leakage is found, stop classification and raise a separate exact-repro security fix.

**Ledger outcome proposed only:** API methods unchanged = 498 total, 461 provisional private COVERED, 24 PUBLIC-BY-DESIGN, 12 operations-token-only, **1 GAP (SSO resolve)**. Scoped pages = 21 total: 20 provisional COVERED, **1 PUBLIC-BY-DESIGN (Careers), 0 GAP**. `acceptanceStatus` remains **NOT ACCEPTED**. A count of zero page GAP labels is not an independent security approval or real-customer launch decision.

No production/Neon SQL, real employers, applicants, external identity providers, migration, feature activation, deployed app change, payroll, filing or funds. Do not merge automatically.

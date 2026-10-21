# Tenant isolation closure plan — 490 API methods and 20 page/action surfaces

> **NOT ACCEPTED — baseline only.** Audited GitHub `main@28e1224448342c34a4899fb67660b3da504530c1` on 2026-10-21: 289 route files, 490 HTTP methods, **76 COVERED / 8 PUBLIC-BY-DESIGN / 406 GAP**, plus **20 page/action GAPs**. No additional methods are certified by writing this plan. This document is a **frozen 406-method closure queue**; later PRs must update the live manifest and the inventory headline independently. Manifest acceptance stays **NOT ACCEPTED**; an independent owner/reviewer decides acceptance.

## Safety boundary and method evidence contract

Operate only on fictional three-employer fixtures (victim employer A plus attackers B and C), dedicated localhost Next.js in production mode, real disposable PostgreSQL 16 (`/app_db`), temporary test-process-only flags and dummy secrets. **Never** use Neon, a production endpoint/DB, real bank details, real workers, production SQL, deploy flags, new migrations, provider HTTP calls or actual money movement. Preserve `requireDisposable`, existing tests, exact HTTP statuses, and maker/checker/payroll calculation behavior. The existing CI provisioning via `npm run db:push` targets only ephemeral PG; no migration files or production schema are changed by this plan.

A method can become `COVERED` **only after its exact method executes and passes in CI on its PR head** with these **four independently traceable assertions**:

1. **Legitimate positive:** signed-in attacker B, then independently C, successfully accesses/creates/updates/deletes a seeded **own** object through the same method. Confirm response content or DB result refers to the actual own object, not an empty/feature-disabled response. For download/exports assert real synthetic bytes, content type, digest/filename where applicable.
2. **Real victim denial:** create and read back a victim-exclusive row **in the real PG DB**, with a victim object ID above attacker IDs and >6. Use the same authenticated attacker to send the real victim ID; assert the handler's **exact** expected denial (403 or 404 per contract), with no victim data in body, headers, redirects or attachment bytes. A 401, invented-id 404, 429, empty list, never-hit method, or 501 own path is **not** coverage.
3. **Victim remains unchanged:** on POST/PATCH/PUT/DELETE prove by actual before/after PG queries that the victim row and connected records (evidence, ledger, audit, payroll/payout state) are unchanged. For reads snapshot/compare if side effects are possible.
4. **Forged selectors:** repeat with a victim `organizationId`, `employeeId`, `runId`, `legalEntityId`, object path ID or other supplied selector; prove explicit rejection or demonstrate the ID is ignored and actual own-scoped result persists. Do this even when a UI normally hides the parameter.

Write `testedBy` file and **precise test line references for ownPositive, foreignDenial, unchangedDb (mutations), and forgedSelector**. The existing manifest schema has `line`, `ownPositiveLine`, `foreignDenialLine` and `unchangedDbLine`; add a fourth-selector reference only when its live assertion truly exists. Retest previously COVERED claims against this complete contract; do not synthesize missing links. Keep separate exact expected status per endpoint and report unexpected failures as GAP/finding rather than bypassing them.

## Batch queue and grouping rules

Source: [method manifest](../../scripts/qa/tenant-isolation-coverage-manifest.json). One PR per **entire batch** below; keep method membership stable against this baseline, and re-fetch `origin/main` before branching each PR. Methods spanning multiple endpoints stay separate proof cases. A batch PR must report baseline/after counts, methods truly proven, leaks found/fixed, remaining gaps, unchanged-victim snapshots, exact commands/output and the head-SHA GitHub Actions links. Do **not** promote incomplete cases to COVERED to hit a target count.

| Phase | Priority surface | Batch IDs | GAP methods (baseline) |
|---:|---|---|---:|
| 1 | Downloads, exports and files | DL-01, DL-02 | 52 |
| 2 | Money mutations | MNY-01, MNY-02 | 66 |
| 3 | Compliance and statutory | STA-01 | 27 |
| 4 | Personal/employee data | PII-01, PII-02 | 77 |
| 5 | Workforce and multi-entity | WRK-01, WRK-02, WRK-03 | 118 |
| 6 | Auth, public edge and integrations | EDG-01, EDG-02 | 66 |

### Batch DL-01 — Tax, statutory, payroll exports and employee document/import files (26 methods; phase 1)

**Shared fixture:** PDF/csv bytes, statutory batches, payroll run, real vault/document row and employee import; no provider. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/bir/annual-employer/module-evidence` — [source](../../src/app/api/bir/annual-employer/module-evidence/route.ts#L65)
- `POST /api/bir/annual-employer/module-evidence` — [source](../../src/app/api/bir/annual-employer/module-evidence/route.ts#L95)
- `GET /api/compliance/contribution-issues/evidence` — [source](../../src/app/api/compliance/contribution-issues/evidence/route.ts#L41)
- `GET /api/compliance/filing-validations/[id]/file` — [source](../../src/app/api/compliance/filing-validations/[id]/file/route.ts#L14)
- `GET /api/compliance/labor-inspection/evidence-pack` — [source](../../src/app/api/compliance/labor-inspection/evidence-pack/route.ts#L23)
- `GET /api/compliance/statutory-remittances/payment-evidence` — [source](../../src/app/api/compliance/statutory-remittances/payment-evidence/route.ts#L57)
- `POST /api/compliance/statutory-remittances/payment-evidence` — [source](../../src/app/api/compliance/statutory-remittances/payment-evidence/route.ts#L95)
- `GET /api/compliance/statutory-remittances/payment-evidence/[id]` — [source](../../src/app/api/compliance/statutory-remittances/payment-evidence/[id]/route.ts#L11)
- `GET /api/compliance/statutory-remittances/posting-evidence/[id]` — [source](../../src/app/api/compliance/statutory-remittances/posting-evidence/[id]/route.ts#L22)
- `GET /api/compliance/statutory-remittances/posting-import` — [source](../../src/app/api/compliance/statutory-remittances/posting-import/route.ts#L41)
- `POST /api/compliance/statutory-remittances/posting-import` — [source](../../src/app/api/compliance/statutory-remittances/posting-import/route.ts#L52)
- `GET /api/year-end/2316-certificate` — [source](../../src/app/api/year-end/2316-certificate/route.ts#L54)
- `POST /api/year-end/2316-certificate` — [source](../../src/app/api/year-end/2316-certificate/route.ts#L55)
- `GET /api/year-end/prior-evidence` — [source](../../src/app/api/year-end/prior-evidence/route.ts#L33)
- `POST /api/year-end/prior-evidence` — [source](../../src/app/api/year-end/prior-evidence/route.ts#L34)
- `GET /api/separation/[id]/2316` — [source](../../src/app/api/separation/[id]/2316/route.ts#L28)
- `GET /api/payroll-runs/[id]/exports` — [source](../../src/app/api/payroll-runs/[id]/exports/route.ts#L51)
- `POST /api/payroll-runs/[id]/exports` — [source](../../src/app/api/payroll-runs/[id]/exports/route.ts#L316)
- `GET /api/bi-exports` — [source](../../src/app/api/bi-exports/route.ts#L28)
- `GET /api/exports` — [source](../../src/app/api/exports/route.ts#L19)
- `POST /api/documents` — [source](../../src/app/api/documents/route.ts#L115)
- `GET /api/employee-vault` — [source](../../src/app/api/employee-vault/route.ts#L13)
- `DELETE /api/employee-vault/[id]` — [source](../../src/app/api/employee-vault/[id]/route.ts#L15)
- `GET /api/employees/import` — [source](../../src/app/api/employees/import/route.ts#L269)
- `POST /api/employees/import` — [source](../../src/app/api/employees/import/route.ts#L19)
- `GET /api/employees/import/template` — [source](../../src/app/api/employees/import/template/route.ts#L14)

### Batch DL-02 — Self-service files, HR evidence, photos, report exports and workforce evidence (26 methods; phase 1)

**Shared fixture:** employee principal, HR document, photo bytes, workforce evidence, report config and nonempty export. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/hcm-report-builder` — [source](../../src/app/api/hcm-report-builder/route.ts#L43)
- `POST /api/hcm-report-builder` — [source](../../src/app/api/hcm-report-builder/route.ts#L61)
- `GET /api/hcm/documents` — [source](../../src/app/api/hcm/documents/route.ts#L59)
- `POST /api/hcm/documents` — [source](../../src/app/api/hcm/documents/route.ts#L248)
- `GET /api/hcm/employment-term-decisions/[id]/evidence` — [source](../../src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts#L100)
- `POST /api/hcm/employment-term-decisions/[id]/evidence` — [source](../../src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts#L136)
- `GET /api/multi-entity/reports` — [source](../../src/app/api/multi-entity/reports/route.ts#L11)
- `GET /api/performance/evidence` — [source](../../src/app/api/performance/evidence/route.ts#L16)
- `DELETE /api/report-builder/saved` — [source](../../src/app/api/report-builder/saved/route.ts#L102)
- `GET /api/report-builder/saved` — [source](../../src/app/api/report-builder/saved/route.ts#L35)
- `PATCH /api/report-builder/saved` — [source](../../src/app/api/report-builder/saved/route.ts#L74)
- `POST /api/report-builder/saved` — [source](../../src/app/api/report-builder/saved/route.ts#L48)
- `GET /api/reports` — [source](../../src/app/api/reports/route.ts#L13)
- `GET /api/reports/builder` — [source](../../src/app/api/reports/builder/route.ts#L69)
- `POST /api/reports/builder` — [source](../../src/app/api/reports/builder/route.ts#L80)
- `GET /api/self/contribution-evidence` — [source](../../src/app/api/self/contribution-evidence/route.ts#L47)
- `GET /api/self/documents` — [source](../../src/app/api/self/documents/route.ts#L47)
- `POST /api/self/documents` — [source](../../src/app/api/self/documents/route.ts#L147)
- `POST /api/self/payslips` — [source](../../src/app/api/self/payslips/route.ts#L371)
- `DELETE /api/self/photo` — [source](../../src/app/api/self/photo/route.ts#L136)
- `GET /api/self/photo` — [source](../../src/app/api/self/photo/route.ts#L59)
- `HEAD /api/self/photo` — [source](../../src/app/api/self/photo/route.ts#L62)
- `POST /api/self/photo` — [source](../../src/app/api/self/photo/route.ts#L66)
- `GET /api/web-bundy/evidence` — [source](../../src/app/api/web-bundy/evidence/route.ts#L60)
- `POST /api/web-bundy/evidence` — [source](../../src/app/api/web-bundy/evidence/route.ts#L88)
- `POST /api/workforce/demand-observations/import` — [source](../../src/app/api/workforce/demand-observations/import/route.ts#L17)

### Batch MNY-01 — Payroll lifecycle, payout destinations and compensation (33 methods; phase 2)

**Shared fixture:** draft/released payroll run, distinct payer/payee, bounded fictional state transitions; no transfer/release to provider. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/payroll-runs/[id]/close` — [source](../../src/app/api/payroll-runs/[id]/close/route.ts#L135)
- `POST /api/payroll-runs/[id]/close` — [source](../../src/app/api/payroll-runs/[id]/close/route.ts#L148)
- `GET /api/payroll-runs/[id]/connected-impact` — [source](../../src/app/api/payroll-runs/[id]/connected-impact/route.ts#L27)
- `POST /api/payroll-runs/[id]/payout-reconciliation` — [source](../../src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts#L211)
- `POST /api/payroll-runs/[id]/pilot-signoff` — [source](../../src/app/api/payroll-runs/[id]/pilot-signoff/route.ts#L75)
- `POST /api/payroll-runs/[id]/process` — [source](../../src/app/api/payroll-runs/[id]/process/route.ts#L15)
- `POST /api/payroll-runs/[id]/release` — [source](../../src/app/api/payroll-runs/[id]/release/route.ts#L30)
- `POST /api/payroll-runs/[id]/submit-review` — [source](../../src/app/api/payroll-runs/[id]/submit-review/route.ts#L21)
- `GET /api/payroll-runs/[id]/variance` — [source](../../src/app/api/payroll-runs/[id]/variance/route.ts#L57)
- `GET /api/payroll-runs/[id]/xendit-payout` — [source](../../src/app/api/payroll-runs/[id]/xendit-payout/route.ts#L62)
- `POST /api/payroll-runs/[id]/xendit-payout` — [source](../../src/app/api/payroll-runs/[id]/xendit-payout/route.ts#L91)
- `GET /api/payroll-underpayments` — [source](../../src/app/api/payroll-underpayments/route.ts#L52)
- `PATCH /api/payroll-underpayments` — [source](../../src/app/api/payroll-underpayments/route.ts#L231)
- `POST /api/payroll-underpayments` — [source](../../src/app/api/payroll-underpayments/route.ts#L103)
- `GET /api/payroll-earnings` — [source](../../src/app/api/payroll-earnings/route.ts#L132)
- `PATCH /api/payroll-earnings` — [source](../../src/app/api/payroll-earnings/route.ts#L309)
- `POST /api/payroll-earnings` — [source](../../src/app/api/payroll-earnings/route.ts#L182)
- `GET /api/payroll-overpayment-preview` — [source](../../src/app/api/payroll-overpayment-preview/route.ts#L45)
- `POST /api/payroll-overpayment-preview` — [source](../../src/app/api/payroll-overpayment-preview/route.ts#L78)
- `GET /api/payroll/overpayment-preflight` — [source](../../src/app/api/payroll/overpayment-preflight/route.ts#L64)
- `POST /api/payroll/overpayment-preflight` — [source](../../src/app/api/payroll/overpayment-preflight/route.ts#L102)
- `GET /api/payout-destination-changes` — [source](../../src/app/api/payout-destination-changes/route.ts#L10)
- `PATCH /api/payout-destination-changes/[id]` — [source](../../src/app/api/payout-destination-changes/[id]/route.ts#L10)
- `GET /api/payout-profiles` — [source](../../src/app/api/payout-profiles/route.ts#L69)
- `PATCH /api/payout-profiles` — [source](../../src/app/api/payout-profiles/route.ts#L138)
- `GET /api/compensation` — [source](../../src/app/api/compensation/route.ts#L242)
- `PATCH /api/compensation` — [source](../../src/app/api/compensation/route.ts#L825)
- `POST /api/compensation` — [source](../../src/app/api/compensation/route.ts#L472)
- `GET /api/earned-wage` — [source](../../src/app/api/earned-wage/route.ts#L25)
- `PATCH /api/earned-wage` — [source](../../src/app/api/earned-wage/route.ts#L182)
- `POST /api/earned-wage` — [source](../../src/app/api/earned-wage/route.ts#L98)
- `GET /api/year-end` — [source](../../src/app/api/year-end/route.ts#L23)
- `POST /api/year-end` — [source](../../src/app/api/year-end/route.ts#L378)

### Batch MNY-02 — Loans, contractors, expenses, billing and treasury (33 methods; phase 2)

**Shared fixture:** fictional loan, contractor, invoice, expense, card/budget and maker/checker records; no external payment. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `POST /api/approval-chains` — [source](../../src/app/api/approval-chains/route.ts#L72)
- `PATCH /api/approvals/[id]` — [source](../../src/app/api/approvals/[id]/route.ts#L33)
- `GET /api/billing` — [source](../../src/app/api/billing/route.ts#L24)
- `POST /api/billing` — [source](../../src/app/api/billing/route.ts#L64)
- `GET /api/billing/subscription` — [source](../../src/app/api/billing/subscription/route.ts#L12)
- `POST /api/billing/subscription/cancel` — [source](../../src/app/api/billing/subscription/cancel/route.ts#L16)
- `POST /api/billing/subscription/start` — [source](../../src/app/api/billing/subscription/start/route.ts#L18)
- `DELETE /api/contractors` — [source](../../src/app/api/contractors/route.ts#L167)
- `GET /api/contractors` — [source](../../src/app/api/contractors/route.ts#L9)
- `PATCH /api/contractors` — [source](../../src/app/api/contractors/route.ts#L96)
- `POST /api/contractors` — [source](../../src/app/api/contractors/route.ts#L38)
- `GET /api/contractors/payments` — [source](../../src/app/api/contractors/payments/route.ts#L42)
- `POST /api/contractors/payments` — [source](../../src/app/api/contractors/payments/route.ts#L173)
- `DELETE /api/de-minimis` — [source](../../src/app/api/de-minimis/route.ts#L170)
- `GET /api/de-minimis` — [source](../../src/app/api/de-minimis/route.ts#L20)
- `POST /api/de-minimis` — [source](../../src/app/api/de-minimis/route.ts#L65)
- `GET /api/expenses` — [source](../../src/app/api/expenses/route.ts#L15)
- `PATCH /api/expenses` — [source](../../src/app/api/expenses/route.ts#L197)
- `POST /api/expenses` — [source](../../src/app/api/expenses/route.ts#L94)
- `GET /api/expenses/receipts` — [source](../../src/app/api/expenses/receipts/route.ts#L45)
- `POST /api/expenses/receipts` — [source](../../src/app/api/expenses/receipts/route.ts#L87)
- `GET /api/loans` — [source](../../src/app/api/loans/route.ts#L39)
- `PATCH /api/loans` — [source](../../src/app/api/loans/route.ts#L219)
- `POST /api/loans` — [source](../../src/app/api/loans/route.ts#L105)
- `POST /api/loans/schedule-preview` — [source](../../src/app/api/loans/schedule-preview/route.ts#L16)
- `POST /api/managed-payroll/runs/[id]/approve` — [source](../../src/app/api/managed-payroll/runs/[id]/approve/route.ts#L17)
- `GET /api/organizations/[id]/payroll-approvers` — [source](../../src/app/api/organizations/[id]/payroll-approvers/route.ts#L15)
- `POST /api/payroll-outsourcing/quote` — [source](../../src/app/api/payroll-outsourcing/quote/route.ts#L16)
- `GET /api/spend` — [source](../../src/app/api/spend/route.ts#L36)
- `PATCH /api/spend` — [source](../../src/app/api/spend/route.ts#L190)
- `POST /api/spend` — [source](../../src/app/api/spend/route.ts#L76)
- `GET /api/treasury-controls` — [source](../../src/app/api/treasury-controls/route.ts#L56)
- `POST /api/treasury-controls` — [source](../../src/app/api/treasury-controls/route.ts#L120)

### Batch STA-01 — Statutory remittance, government loan, labor inspection and data requests (27 methods; phase 3)

**Shared fixture:** same fictional statutory batch, contribution task, BIR filing, loan, data request and labor case. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/bir/annual-employer` — [source](../../src/app/api/bir/annual-employer/route.ts#L13)
- `POST /api/bir/annual-employer/candidate` — [source](../../src/app/api/bir/annual-employer/candidate/route.ts#L49)
- `GET /api/compliance/audit-chain` — [source](../../src/app/api/compliance/audit-chain/route.ts#L9)
- `GET /api/compliance/contribution-issues` — [source](../../src/app/api/compliance/contribution-issues/route.ts#L57)
- `POST /api/compliance/contribution-issues` — [source](../../src/app/api/compliance/contribution-issues/route.ts#L129)
- `GET /api/compliance/data-requests` — [source](../../src/app/api/compliance/data-requests/route.ts#L32)
- `PATCH /api/compliance/data-requests` — [source](../../src/app/api/compliance/data-requests/route.ts#L199)
- `POST /api/compliance/data-requests` — [source](../../src/app/api/compliance/data-requests/route.ts#L149)
- `GET /api/compliance/dole-13th-month` — [source](../../src/app/api/compliance/dole-13th-month/route.ts#L40)
- `POST /api/compliance/dole-13th-month` — [source](../../src/app/api/compliance/dole-13th-month/route.ts#L129)
- `GET /api/compliance/filing-validations` — [source](../../src/app/api/compliance/filing-validations/route.ts#L20)
- `POST /api/compliance/filing-validations` — [source](../../src/app/api/compliance/filing-validations/route.ts#L65)
- `PATCH /api/compliance/filing-validations/[id]` — [source](../../src/app/api/compliance/filing-validations/[id]/route.ts#L21)
- `GET /api/compliance/government-loan-remittances` — [source](../../src/app/api/compliance/government-loan-remittances/route.ts#L59)
- `POST /api/compliance/government-loan-remittances` — [source](../../src/app/api/compliance/government-loan-remittances/route.ts#L124)
- `GET /api/compliance/labor-inspection` — [source](../../src/app/api/compliance/labor-inspection/route.ts#L32)
- `POST /api/compliance/labor-inspection` — [source](../../src/app/api/compliance/labor-inspection/route.ts#L47)
- `GET /api/compliance/labor-inspection/drills` — [source](../../src/app/api/compliance/labor-inspection/drills/route.ts#L48)
- `POST /api/compliance/labor-inspection/drills` — [source](../../src/app/api/compliance/labor-inspection/drills/route.ts#L90)
- `GET /api/compliance/payroll-month-close` — [source](../../src/app/api/compliance/payroll-month-close/route.ts#L40)
- `POST /api/compliance/payroll-month-close` — [source](../../src/app/api/compliance/payroll-month-close/route.ts#L84)
- `GET /api/compliance/policy-review` — [source](../../src/app/api/compliance/policy-review/route.ts#L12)
- `GET /api/compliance/remittance-actions` — [source](../../src/app/api/compliance/remittance-actions/route.ts#L93)
- `POST /api/compliance/remittance-actions` — [source](../../src/app/api/compliance/remittance-actions/route.ts#L109)
- `GET /api/compliance/statutory-remittances` — [source](../../src/app/api/compliance/statutory-remittances/route.ts#L64)
- `POST /api/compliance/statutory-remittances` — [source](../../src/app/api/compliance/statutory-remittances/route.ts#L103)
- `POST /api/compliance/validate` — [source](../../src/app/api/compliance/validate/route.ts#L30)

### Batch PII-01 — HCM worker and lifecycle identities (39 methods; phase 4)

**Shared fixture:** worker profile, job, employment-term decision, organization tree, worker-360 and related documents. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/hcm/business-processes/definitions` — [source](../../src/app/api/hcm/business-processes/definitions/route.ts#L48)
- `POST /api/hcm/business-processes/definitions` — [source](../../src/app/api/hcm/business-processes/definitions/route.ts#L89)
- `GET /api/hcm/capabilities` — [source](../../src/app/api/hcm/capabilities/route.ts#L26)
- `POST /api/hcm/capabilities` — [source](../../src/app/api/hcm/capabilities/route.ts#L103)
- `GET /api/hcm/effective-changes` — [source](../../src/app/api/hcm/effective-changes/route.ts#L86)
- `PATCH /api/hcm/effective-changes` — [source](../../src/app/api/hcm/effective-changes/route.ts#L476)
- `POST /api/hcm/effective-changes` — [source](../../src/app/api/hcm/effective-changes/route.ts#L115)
- `GET /api/hcm/employment-term-decisions` — [source](../../src/app/api/hcm/employment-term-decisions/route.ts#L51)
- `PATCH /api/hcm/employment-term-decisions` — [source](../../src/app/api/hcm/employment-term-decisions/route.ts#L268)
- `POST /api/hcm/employment-term-decisions` — [source](../../src/app/api/hcm/employment-term-decisions/route.ts#L77)
- `GET /api/hcm/employment-term-decisions/[id]/manager-attestation` — [source](../../src/app/api/hcm/employment-term-decisions/[id]/manager-attestation/route.ts#L57)
- `POST /api/hcm/employment-term-decisions/[id]/manager-attestation` — [source](../../src/app/api/hcm/employment-term-decisions/[id]/manager-attestation/route.ts#L90)
- `GET /api/hcm/employment-terms` — [source](../../src/app/api/hcm/employment-terms/route.ts#L46)
- `PATCH /api/hcm/employment-terms` — [source](../../src/app/api/hcm/employment-terms/route.ts#L198)
- `POST /api/hcm/employment-terms` — [source](../../src/app/api/hcm/employment-terms/route.ts#L86)
- `GET /api/hcm/engagement-surveys` — [source](../../src/app/api/hcm/engagement-surveys/route.ts#L32)
- `POST /api/hcm/engagement-surveys` — [source](../../src/app/api/hcm/engagement-surveys/route.ts#L72)
- `GET /api/hcm/lifecycle-policy` — [source](../../src/app/api/hcm/lifecycle-policy/route.ts#L46)
- `PATCH /api/hcm/lifecycle-policy` — [source](../../src/app/api/hcm/lifecycle-policy/route.ts#L79)
- `GET /api/hcm/lifecycle-readiness` — [source](../../src/app/api/hcm/lifecycle-readiness/route.ts#L9)
- `GET /api/hcm/manager-decision-inbox` — [source](../../src/app/api/hcm/manager-decision-inbox/route.ts#L27)
- `GET /api/hcm/my-team` — [source](../../src/app/api/hcm/my-team/route.ts#L26)
- `GET /api/hcm/org-explorer` — [source](../../src/app/api/hcm/org-explorer/route.ts#L11)
- `GET /api/hcm/people-operations-inbox` — [source](../../src/app/api/hcm/people-operations-inbox/route.ts#L19)
- `GET /api/hcm/position-history` — [source](../../src/app/api/hcm/position-history/route.ts#L11)
- `GET /api/hcm/probation-reviews` — [source](../../src/app/api/hcm/probation-reviews/route.ts#L126)
- `PATCH /api/hcm/probation-reviews` — [source](../../src/app/api/hcm/probation-reviews/route.ts#L234)
- `POST /api/hcm/probation-reviews` — [source](../../src/app/api/hcm/probation-reviews/route.ts#L156)
- `GET /api/hcm/process-monitor` — [source](../../src/app/api/hcm/process-monitor/route.ts#L20)
- `POST /api/hcm/salary-corrections/preview` — [source](../../src/app/api/hcm/salary-corrections/preview/route.ts#L24)
- `GET /api/hcm/team-leave-calendar` — [source](../../src/app/api/hcm/team-leave-calendar/route.ts#L23)
- `GET /api/hcm/work-items` — [source](../../src/app/api/hcm/work-items/route.ts#L24)
- `PATCH /api/hcm/work-items` — [source](../../src/app/api/hcm/work-items/route.ts#L48)
- `POST /api/hcm/work-items/escalate` — [source](../../src/app/api/hcm/work-items/escalate/route.ts#L16)
- `GET /api/hcm/work-items/events` — [source](../../src/app/api/hcm/work-items/events/route.ts#L8)
- `GET /api/hcm/worker-360` — [source](../../src/app/api/hcm/worker-360/route.ts#L25)
- `GET /api/hcm/worker-profile` — [source](../../src/app/api/hcm/worker-profile/route.ts#L66)
- `GET /api/employee-identifier-requests` — [source](../../src/app/api/employee-identifier-requests/route.ts#L31)
- `POST /api/employee-identifier-requests` — [source](../../src/app/api/employee-identifier-requests/route.ts#L86)

### Batch PII-02 — Employees, recruitment, discipline and self-service records (38 methods; phase 4)

**Shared fixture:** real employee and applicant, personal identifiers, active worker session, discipline/recruitment case. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/careers` — [source](../../src/app/api/careers/route.ts#L26)
- `POST /api/careers` — [source](../../src/app/api/careers/route.ts#L51)
- `PATCH /api/careers/admin` — [source](../../src/app/api/careers/admin/route.ts#L14)
- `GET /api/discipline` — [source](../../src/app/api/discipline/route.ts#L11)
- `PATCH /api/discipline` — [source](../../src/app/api/discipline/route.ts#L112)
- `POST /api/discipline` — [source](../../src/app/api/discipline/route.ts#L52)
- `PATCH /api/employees` — [source](../../src/app/api/employees/route.ts#L410)
- `POST /api/employees` — [source](../../src/app/api/employees/route.ts#L116)
- `GET /api/employees/[id]/mwe-classifications` — [source](../../src/app/api/employees/[id]/mwe-classifications/route.ts#L23)
- `POST /api/employees/[id]/mwe-classifications` — [source](../../src/app/api/employees/[id]/mwe-classifications/route.ts#L58)
- `PATCH /api/employees/[id]/mwe-classifications/[classificationId]` — [source](../../src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts#L18)
- `GET /api/recruitment` — [source](../../src/app/api/recruitment/route.ts#L60)
- `PATCH /api/recruitment` — [source](../../src/app/api/recruitment/route.ts#L581)
- `POST /api/recruitment` — [source](../../src/app/api/recruitment/route.ts#L163)
- `POST /api/recruitment/hire` — [source](../../src/app/api/recruitment/hire/route.ts#L53)
- `GET /api/recruitment/privacy` — [source](../../src/app/api/recruitment/privacy/route.ts#L30)
- `PATCH /api/recruitment/privacy` — [source](../../src/app/api/recruitment/privacy/route.ts#L81)
- `GET /api/self/availability` — [source](../../src/app/api/self/availability/route.ts#L54)
- `POST /api/self/availability` — [source](../../src/app/api/self/availability/route.ts#L101)
- `GET /api/self/contribution-issues` — [source](../../src/app/api/self/contribution-issues/route.ts#L52)
- `POST /api/self/contribution-issues` — [source](../../src/app/api/self/contribution-issues/route.ts#L104)
- `GET /api/self/identifiers` — [source](../../src/app/api/self/identifiers/route.ts#L38)
- `POST /api/self/identifiers` — [source](../../src/app/api/self/identifiers/route.ts#L81)
- `GET /api/self/performance` — [source](../../src/app/api/self/performance/route.ts#L47)
- `PATCH /api/self/performance` — [source](../../src/app/api/self/performance/route.ts#L226)
- `POST /api/self/performance` — [source](../../src/app/api/self/performance/route.ts#L167)
- `PATCH /api/self/performance/action-items` — [source](../../src/app/api/self/performance/action-items/route.ts#L48)
- `GET /api/self/performance/development-plans` — [source](../../src/app/api/self/performance/development-plans/route.ts#L36)
- `PATCH /api/self/performance/development-plans` — [source](../../src/app/api/self/performance/development-plans/route.ts#L139)
- `POST /api/self/performance/development-plans` — [source](../../src/app/api/self/performance/development-plans/route.ts#L77)
- `GET /api/self/probation-reviews` — [source](../../src/app/api/self/probation-reviews/route.ts#L45)
- `POST /api/self/probation-reviews` — [source](../../src/app/api/self/probation-reviews/route.ts#L73)
- `PATCH /api/self/profile` — [source](../../src/app/api/self/profile/route.ts#L18)
- `GET /api/self/schedule-receipts` — [source](../../src/app/api/self/schedule-receipts/route.ts#L35)
- `POST /api/self/schedule-receipts` — [source](../../src/app/api/self/schedule-receipts/route.ts#L44)
- `GET /api/self/take-home-estimate` — [source](../../src/app/api/self/take-home-estimate/route.ts#L16)
- `GET /api/self/workforce` — [source](../../src/app/api/self/workforce/route.ts#L81)
- `POST /api/self/workforce` — [source](../../src/app/api/self/workforce/route.ts#L140)

### Batch WRK-01 — Workforce time, attendance, schedules and work sites (39 methods; phase 5)

**Shared fixture:** worker, timesheet, worksite, schedule, approval and attendance events. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/workforce/attendance-corrections` — [source](../../src/app/api/workforce/attendance-corrections/route.ts#L81)
- `POST /api/workforce/attendance-corrections` — [source](../../src/app/api/workforce/attendance-corrections/route.ts#L136)
- `GET /api/workforce/coverage` — [source](../../src/app/api/workforce/coverage/route.ts#L788)
- `POST /api/workforce/coverage` — [source](../../src/app/api/workforce/coverage/route.ts#L1369)
- `GET /api/workforce/demand-observations/issued` — [source](../../src/app/api/workforce/demand-observations/issued/route.ts#L32)
- `POST /api/workforce/demand-observations/issued` — [source](../../src/app/api/workforce/demand-observations/issued/route.ts#L61)
- `POST /api/workforce/demand-observations/issued/score` — [source](../../src/app/api/workforce/demand-observations/issued/score/route.ts#L20)
- `GET /api/workforce/demand-observations/loyverse` — [source](../../src/app/api/workforce/demand-observations/loyverse/route.ts#L43)
- `POST /api/workforce/demand-observations/loyverse` — [source](../../src/app/api/workforce/demand-observations/loyverse/route.ts#L113)
- `GET /api/workforce/demand-observations/outlook` — [source](../../src/app/api/workforce/demand-observations/outlook/route.ts#L16)
- `GET /api/workforce/demand-observations/square-sandbox` — [source](../../src/app/api/workforce/demand-observations/square-sandbox/route.ts#L39)
- `POST /api/workforce/demand-observations/square-sandbox` — [source](../../src/app/api/workforce/demand-observations/square-sandbox/route.ts#L100)
- `GET /api/workforce/demand-outlook` — [source](../../src/app/api/workforce/demand-outlook/route.ts#L18)
- `GET /api/workforce/demand-staffing/policies` — [source](../../src/app/api/workforce/demand-staffing/policies/route.ts#L39)
- `PATCH /api/workforce/demand-staffing/policies` — [source](../../src/app/api/workforce/demand-staffing/policies/route.ts#L125)
- `POST /api/workforce/demand-staffing/policies` — [source](../../src/app/api/workforce/demand-staffing/policies/route.ts#L89)
- `GET /api/workforce/greedy-roster` — [source](../../src/app/api/workforce/greedy-roster/route.ts#L17)
- `GET /api/workforce/labor-costing` — [source](../../src/app/api/workforce/labor-costing/route.ts#L78)
- `POST /api/workforce/labor-costing` — [source](../../src/app/api/workforce/labor-costing/route.ts#L133)
- `GET /api/workforce/live-floor` — [source](../../src/app/api/workforce/live-floor/route.ts#L34)
- `GET /api/workforce/overtime` — [source](../../src/app/api/workforce/overtime/route.ts#L230)
- `POST /api/workforce/overtime` — [source](../../src/app/api/workforce/overtime/route.ts#L319)
- `GET /api/workforce/roster-batches` — [source](../../src/app/api/workforce/roster-batches/route.ts#L42)
- `POST /api/workforce/roster-batches` — [source](../../src/app/api/workforce/roster-batches/route.ts#L94)
- `GET /api/workforce/roster-rules` — [source](../../src/app/api/workforce/roster-rules/route.ts#L13)
- `POST /api/workforce/roster-rules` — [source](../../src/app/api/workforce/roster-rules/route.ts#L28)
- `POST /api/workforce/roster-rules/preview` — [source](../../src/app/api/workforce/roster-rules/preview/route.ts#L14)
- `GET /api/workforce/schedule-guardrails` — [source](../../src/app/api/workforce/schedule-guardrails/route.ts#L33)
- `POST /api/workforce/schedule-guardrails` — [source](../../src/app/api/workforce/schedule-guardrails/route.ts#L62)
- `GET /api/workforce/schedule-receipt-review` — [source](../../src/app/api/workforce/schedule-receipt-review/route.ts#L19)
- `GET /api/workforce/schedule-swaps` — [source](../../src/app/api/workforce/schedule-swaps/route.ts#L229)
- `POST /api/workforce/schedule-swaps` — [source](../../src/app/api/workforce/schedule-swaps/route.ts#L274)
- `GET /api/workforce/schedules` — [source](../../src/app/api/workforce/schedules/route.ts#L152)
- `POST /api/workforce/schedules` — [source](../../src/app/api/workforce/schedules/route.ts#L359)
- `GET /api/workforce/team-roster` — [source](../../src/app/api/workforce/team-roster/route.ts#L39)
- `GET /api/workforce/timesheets` — [source](../../src/app/api/workforce/timesheets/route.ts#L54)
- `POST /api/workforce/timesheets` — [source](../../src/app/api/workforce/timesheets/route.ts#L122)
- `GET /api/workforce/worksites` — [source](../../src/app/api/workforce/worksites/route.ts#L114)
- `POST /api/workforce/worksites` — [source](../../src/app/api/workforce/worksites/route.ts#L198)

### Batch WRK-02 — Performance and workforce planning (39 methods; phase 5)

**Shared fixture:** owned performance review, objective, forecast, position and allocations. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/performance` — [source](../../src/app/api/performance/route.ts#L316)
- `PATCH /api/performance` — [source](../../src/app/api/performance/route.ts#L752)
- `POST /api/performance` — [source](../../src/app/api/performance/route.ts#L403)
- `PATCH /api/performance/action-items` — [source](../../src/app/api/performance/action-items/route.ts#L250)
- `POST /api/performance/action-items` — [source](../../src/app/api/performance/action-items/route.ts#L167)
- `GET /api/performance/analytics` — [source](../../src/app/api/performance/analytics/route.ts#L43)
- `GET /api/performance/calibration` — [source](../../src/app/api/performance/calibration/route.ts#L50)
- `PATCH /api/performance/calibration` — [source](../../src/app/api/performance/calibration/route.ts#L188)
- `POST /api/performance/calibration` — [source](../../src/app/api/performance/calibration/route.ts#L94)
- `GET /api/performance/competencies` — [source](../../src/app/api/performance/competencies/route.ts#L50)
- `PATCH /api/performance/competencies` — [source](../../src/app/api/performance/competencies/route.ts#L358)
- `POST /api/performance/competencies` — [source](../../src/app/api/performance/competencies/route.ts#L176)
- `GET /api/performance/continuous` — [source](../../src/app/api/performance/continuous/route.ts#L67)
- `PATCH /api/performance/continuous` — [source](../../src/app/api/performance/continuous/route.ts#L288)
- `POST /api/performance/continuous` — [source](../../src/app/api/performance/continuous/route.ts#L164)
- `GET /api/performance/development-plans` — [source](../../src/app/api/performance/development-plans/route.ts#L165)
- `PATCH /api/performance/development-plans` — [source](../../src/app/api/performance/development-plans/route.ts#L379)
- `POST /api/performance/development-plans` — [source](../../src/app/api/performance/development-plans/route.ts#L221)
- `GET /api/performance/follow-through-governance` — [source](../../src/app/api/performance/follow-through-governance/route.ts#L71)
- `PATCH /api/performance/follow-through-governance` — [source](../../src/app/api/performance/follow-through-governance/route.ts#L116)
- `GET /api/performance/talent-continuity` — [source](../../src/app/api/performance/talent-continuity/route.ts#L30)
- `GET /api/workforce-planning` — [source](../../src/app/api/workforce-planning/route.ts#L75)
- `PATCH /api/workforce-planning` — [source](../../src/app/api/workforce-planning/route.ts#L779)
- `POST /api/workforce-planning` — [source](../../src/app/api/workforce-planning/route.ts#L175)
- `GET /api/workforce-planning/allocations` — [source](../../src/app/api/workforce-planning/allocations/route.ts#L72)
- `PATCH /api/workforce-planning/allocations` — [source](../../src/app/api/workforce-planning/allocations/route.ts#L418)
- `POST /api/workforce-planning/allocations` — [source](../../src/app/api/workforce-planning/allocations/route.ts#L145)
- `GET /api/workforce-planning/baselines` — [source](../../src/app/api/workforce-planning/baselines/route.ts#L145)
- `POST /api/workforce-planning/baselines` — [source](../../src/app/api/workforce-planning/baselines/route.ts#L259)
- `POST /api/workforce-planning/demand-handoff` — [source](../../src/app/api/workforce-planning/demand-handoff/route.ts#L33)
- `GET /api/workforce-planning/forecast` — [source](../../src/app/api/workforce-planning/forecast/route.ts#L25)
- `POST /api/workforce-planning/forecast-plan` — [source](../../src/app/api/workforce-planning/forecast-plan/route.ts#L85)
- `GET /api/workforce-planning/position-executions` — [source](../../src/app/api/workforce-planning/position-executions/route.ts#L145)
- `PATCH /api/workforce-planning/position-executions` — [source](../../src/app/api/workforce-planning/position-executions/route.ts#L318)
- `POST /api/workforce-planning/position-executions` — [source](../../src/app/api/workforce-planning/position-executions/route.ts#L184)
- `GET /api/workforce-planning/scenarios` — [source](../../src/app/api/workforce-planning/scenarios/route.ts#L91)
- `PATCH /api/workforce-planning/scenarios` — [source](../../src/app/api/workforce-planning/scenarios/route.ts#L356)
- `POST /api/workforce-planning/scenarios` — [source](../../src/app/api/workforce-planning/scenarios/route.ts#L195)
- `POST /api/workforce-planning/transfer` — [source](../../src/app/api/workforce-planning/transfer/route.ts#L23)

### Batch WRK-03 — Multi-entity, benefits, leave, holidays and Web Bundy (40 methods; phase 5)

**Shared fixture:** unit/legal entity, attendance evidence, benefits, holiday, leave and delegated manager permissions. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/attendance/offline-claims` — [source](../../src/app/api/attendance/offline-claims/route.ts#L22)
- `PATCH /api/attendance/offline-claims` — [source](../../src/app/api/attendance/offline-claims/route.ts#L140)
- `POST /api/attendance/offline-claims` — [source](../../src/app/api/attendance/offline-claims/route.ts#L67)
- `DELETE /api/benefits` — [source](../../src/app/api/benefits/route.ts#L147)
- `GET /api/benefits` — [source](../../src/app/api/benefits/route.ts#L13)
- `POST /api/benefits` — [source](../../src/app/api/benefits/route.ts#L60)
- `PUT /api/benefits` — [source](../../src/app/api/benefits/route.ts#L208)
- `GET /api/benefits/hmo` — [source](../../src/app/api/benefits/hmo/route.ts#L33)
- `POST /api/benefits/hmo` — [source](../../src/app/api/benefits/hmo/route.ts#L117)
- `GET /api/biometrics/sync` — [source](../../src/app/api/biometrics/sync/route.ts#L16)
- `POST /api/biometrics/sync` — [source](../../src/app/api/biometrics/sync/route.ts#L53)
- `GET /api/delegations` — [source](../../src/app/api/delegations/route.ts#L19)
- `PATCH /api/delegations` — [source](../../src/app/api/delegations/route.ts#L139)
- `POST /api/delegations` — [source](../../src/app/api/delegations/route.ts#L58)
- `GET /api/dynamic-worker-groups` — [source](../../src/app/api/dynamic-worker-groups/route.ts#L143)
- `POST /api/dynamic-worker-groups` — [source](../../src/app/api/dynamic-worker-groups/route.ts#L213)
- `DELETE /api/holidays` — [source](../../src/app/api/holidays/route.ts#L421)
- `GET /api/holidays` — [source](../../src/app/api/holidays/route.ts#L128)
- `PATCH /api/holidays` — [source](../../src/app/api/holidays/route.ts#L295)
- `POST /api/holidays` — [source](../../src/app/api/holidays/route.ts#L190)
- `GET /api/leave` — [source](../../src/app/api/leave/route.ts#L136)
- `POST /api/leave` — [source](../../src/app/api/leave/route.ts#L205)
- `GET /api/leave/conversion` — [source](../../src/app/api/leave/conversion/route.ts#L11)
- `POST /api/leave/conversion` — [source](../../src/app/api/leave/conversion/route.ts#L52)
- `POST /api/leave/preview` — [source](../../src/app/api/leave/preview/route.ts#L23)
- `GET /api/multi-entity/context` — [source](../../src/app/api/multi-entity/context/route.ts#L13)
- `PATCH /api/multi-entity/context` — [source](../../src/app/api/multi-entity/context/route.ts#L25)
- `GET /api/multi-entity/registration-changes` — [source](../../src/app/api/multi-entity/registration-changes/route.ts#L43)
- `PATCH /api/multi-entity/registration-changes` — [source](../../src/app/api/multi-entity/registration-changes/route.ts#L160)
- `POST /api/multi-entity/registration-changes` — [source](../../src/app/api/multi-entity/registration-changes/route.ts#L90)
- `GET /api/multi-entity/settings` — [source](../../src/app/api/multi-entity/settings/route.ts#L35)
- `PATCH /api/multi-entity/settings` — [source](../../src/app/api/multi-entity/settings/route.ts#L64)
- `GET /api/multi-entity/transfers` — [source](../../src/app/api/multi-entity/transfers/route.ts#L40)
- `PATCH /api/multi-entity/transfers` — [source](../../src/app/api/multi-entity/transfers/route.ts#L248)
- `POST /api/multi-entity/transfers` — [source](../../src/app/api/multi-entity/transfers/route.ts#L89)
- `GET /api/web-bundy` — [source](../../src/app/api/web-bundy/route.ts#L40)
- `POST /api/web-bundy` — [source](../../src/app/api/web-bundy/route.ts#L127)
- `POST /api/web-bundy/consent` — [source](../../src/app/api/web-bundy/consent/route.ts#L16)
- `GET /api/web-bundy/review` — [source](../../src/app/api/web-bundy/review/route.ts#L39)
- `POST /api/web-bundy/review` — [source](../../src/app/api/web-bundy/review/route.ts#L83)

### Batch EDG-01 — Authentication, account, onboarding and readiness (33 methods; phase 6)

**Shared fixture:** distinct signed-in identities, scoped token/setup links; public-only decisions require per-method owner review. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/account` — [source](../../src/app/api/account/route.ts#L14)
- `POST /api/account/email` — [source](../../src/app/api/account/email/route.ts#L22)
- `POST /api/account/email/verify` — [source](../../src/app/api/account/email/verify/route.ts#L13)
- `POST /api/account/password` — [source](../../src/app/api/account/password/route.ts#L29)
- `POST /api/auth/logout` — [source](../../src/app/api/auth/logout/route.ts#L5)
- `GET /api/auth/me` — [source](../../src/app/api/auth/me/route.ts#L6)
- `POST /api/auth/saml/acs/[providerId]` — [source](../../src/app/api/auth/saml/acs/[providerId]/route.ts#L8)
- `GET /api/auth/saml/metadata/[providerId]` — [source](../../src/app/api/auth/saml/metadata/[providerId]/route.ts#L9)
- `GET /api/auth/saml/start/[providerId]` — [source](../../src/app/api/auth/saml/start/[providerId]/route.ts#L8)
- `GET /api/auth/sso/callback` — [source](../../src/app/api/auth/sso/callback/route.ts#L23)
- `POST /api/auth/sso/resolve` — [source](../../src/app/api/auth/sso/resolve/route.ts#L9)
- `GET /api/auth/sso/start` — [source](../../src/app/api/auth/sso/start/route.ts#L11)
- `GET /api/auth/totp/setup` — [source](../../src/app/api/auth/totp/setup/route.ts#L18)
- `POST /api/auth/totp/setup` — [source](../../src/app/api/auth/totp/setup/route.ts#L32)
- `GET /api/invitations` — [source](../../src/app/api/invitations/route.ts#L17)
- `POST /api/invitations` — [source](../../src/app/api/invitations/route.ts#L60)
- `GET /api/invitations/accept` — [source](../../src/app/api/invitations/accept/route.ts#L15)
- `POST /api/invitations/accept` — [source](../../src/app/api/invitations/accept/route.ts#L23)
- `POST /api/signup` — [source](../../src/app/api/signup/route.ts#L21)
- `POST /api/signup/resend` — [source](../../src/app/api/signup/resend/route.ts#L14)
- `POST /api/signup/verify` — [source](../../src/app/api/signup/verify/route.ts#L14)
- `GET /api/readiness` — [source](../../src/app/api/readiness/route.ts#L7)
- `GET /api/readiness/billing` — [source](../../src/app/api/readiness/billing/route.ts#L15)
- `GET /api/readiness/database-target` — [source](../../src/app/api/readiness/database-target/route.ts#L11)
- `GET /api/readiness/deployment` — [source](../../src/app/api/readiness/deployment/route.ts#L9)
- `GET /api/readiness/pilot-status` — [source](../../src/app/api/readiness/pilot-status/route.ts#L28)
- `GET /api/readiness/workspace` — [source](../../src/app/api/readiness/workspace/route.ts#L7)
- `POST /api/demo-requests` — [source](../../src/app/api/demo-requests/route.ts#L18)
- `GET /api/marketing/leads` — [source](../../src/app/api/marketing/leads/route.ts#L16)
- `POST /api/intake-challenge` — [source](../../src/app/api/intake-challenge/route.ts#L8)
- `GET /api/setup` — [source](../../src/app/api/setup/route.ts#L21)
- `POST /api/setup` — [source](../../src/app/api/setup/route.ts#L28)
- `GET /api/capabilities` — [source](../../src/app/api/capabilities/route.ts#L7)

### Batch EDG-02 — Webhooks, jobs, provisioning and infrastructure integrations (33 methods; phase 6)

**Shared fixture:** dummy signatures, replay check, tenant bound events, signed service sessions and no external provider calls. **Status:** queued (all listed as GAP at baseline). **PR:** not yet created; do not confuse the historical high-risk script name with a completed closure batch.

- `GET /api/automation-studio` — [source](../../src/app/api/automation-studio/route.ts#L211)
- `POST /api/automation-studio` — [source](../../src/app/api/automation-studio/route.ts#L563)
- `GET /api/developer` — [source](../../src/app/api/developer/route.ts#L18)
- `POST /api/developer` — [source](../../src/app/api/developer/route.ts#L63)
- `GET /api/enterprise` — [source](../../src/app/api/enterprise/route.ts#L71)
- `POST /api/enterprise` — [source](../../src/app/api/enterprise/route.ts#L201)
- `GET /api/governed-handoffs` — [source](../../src/app/api/governed-handoffs/route.ts#L59)
- `POST /api/governed-handoffs` — [source](../../src/app/api/governed-handoffs/route.ts#L130)
- `GET /api/integration-connectors` — [source](../../src/app/api/integration-connectors/route.ts#L41)
- `POST /api/integration-connectors` — [source](../../src/app/api/integration-connectors/route.ts#L63)
- `GET /api/it-operations` — [source](../../src/app/api/it-operations/route.ts#L26)
- `PATCH /api/it-operations` — [source](../../src/app/api/it-operations/route.ts#L120)
- `POST /api/it-operations` — [source](../../src/app/api/it-operations/route.ts#L52)
- `GET /api/jobs/cron` — [source](../../src/app/api/jobs/cron/route.ts#L15)
- `GET /api/jobs/dispatch-readiness` — [source](../../src/app/api/jobs/dispatch-readiness/route.ts#L13)
- `GET /api/jobs/status` — [source](../../src/app/api/jobs/status/route.ts#L17)
- `POST /api/jobs/tick` — [source](../../src/app/api/jobs/tick/route.ts#L10)
- `GET /api/migrations` — [source](../../src/app/api/migrations/route.ts#L61)
- `POST /api/migrations` — [source](../../src/app/api/migrations/route.ts#L107)
- `PUT /api/organizations` — [source](../../src/app/api/organizations/route.ts#L15)
- `GET /api/outbox` — [source](../../src/app/api/outbox/route.ts#L20)
- `POST /api/outbox` — [source](../../src/app/api/outbox/route.ts#L89)
- `GET /api/provisioning` — [source](../../src/app/api/provisioning/route.ts#L13)
- `PATCH /api/provisioning` — [source](../../src/app/api/provisioning/route.ts#L50)
- `GET /api/tenant-modules` — [source](../../src/app/api/tenant-modules/route.ts#L25)
- `PATCH /api/tenant-modules` — [source](../../src/app/api/tenant-modules/route.ts#L32)
- `GET /api/v1` — [source](../../src/app/api/v1/route.ts#L6)
- `GET /api/v1/journal-entries` — [source](../../src/app/api/v1/journal-entries/route.ts#L10)
- `POST /api/webhooks/drain` — [source](../../src/app/api/webhooks/drain/route.ts#L14)
- `POST /api/webhooks/paymongo/transfers` — [source](../../src/app/api/webhooks/paymongo/transfers/route.ts#L48)
- `POST /api/webhooks/resend` — [source](../../src/app/api/webhooks/resend/route.ts#L10)
- `POST /api/webhooks/xendit-payout` — [source](../../src/app/api/webhooks/xendit-payout/route.ts#L16)
- `POST /api/webhooks/xendit/subscriptions` — [source](../../src/app/api/webhooks/xendit/subscriptions/route.ts#L31)

## Page and server-action closure (20 independently requested wrong-employer surfaces)

For every page below, seed an authorized **nonempty own-employer page** (or published-only data for the public careers route), request it with a real authenticated own principal (or an actual anonymous caller for a justified public page), then request the victim organization/employee ID with that **same attacker identity**. Assert the exact HTTP status/redirect plus **absence of real victim content** in server-rendered HTML/RSC payloads and data on any invoked server action. For actions, submit a real POST/RSC action request under the wrong employer and compare the real victim DB rows before/after. A feature-disabled 404 or a redirect to login alone is not proof. Reuse `tenant-scoped-page-probes.mjs` as exploratory input only; promote page status after independent HTTP evidence.

- `GET /app/engagement` — `src/app/app/engagement/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /app/goals-reviews` — `src/app/app/goals-reviews/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /app` — `src/app/app/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /billing/setup` — `src/app/billing/setup/page.tsx`; fixture: owner and victim billing org; state: GAP; linked evidence: none
- `GET /careers` — `src/app/careers/page.tsx`; fixture: published vacancy and private victim requisition; state: GAP; linked evidence: none
- `GET /hcm/action-center` — `src/app/hcm/action-center/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/command-center` — `src/app/hcm/command-center/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/hire-payroll-review` — `src/app/hcm/hire-payroll-review/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/hr-cases` — `src/app/hcm/hr-cases/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/manager-decision-inbox` — `src/app/hcm/manager-decision-inbox/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/my-team` — `src/app/hcm/my-team/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/org-explorer` — `src/app/hcm/org-explorer/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/process-monitor` — `src/app/hcm/process-monitor/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/team-leave-calendar` — `src/app/hcm/team-leave-calendar/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/work-items` — `src/app/hcm/work-items/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/worker-360` — `src/app/hcm/worker-360/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /self/schedule-receipts` — `src/app/self/schedule-receipts/page.tsx`; fixture: signed-in employee and victim employee; state: GAP; linked evidence: none
- `GET /workspace/2316` — `src/app/workspace/2316/page.tsx`; fixture: owner and victim statutory data; state: GAP; linked evidence: none
- `GET /workspace/prior-employer` — `src/app/workspace/prior-employer/page.tsx`; fixture: owner and victim statutory data; state: GAP; linked evidence: none
- `GET /workspace/report-builder` — `src/app/workspace/report-builder/page.tsx`; fixture: owner and victim statutory data; state: GAP; linked evidence: none

## CI and proof-link closure guards (incremental, never relaxed)

- Retain [second-pass runner](../../scripts/qa/tenant-second-pass-http.mjs), [route registry](../../scripts/qa/tenant-second-pass-manifest.mjs), [manifest-driven HTTP](../../scripts/qa/tenant-manifest-driven-http.mjs), [high-risk HTTP](../../scripts/qa/tenant-high-risk-01-http.mjs), [bank evidence HTTP](../../scripts/qa/bank-tenant-http.mjs), [delegated source tracer](../../scripts/qa/tenant-delegated-trace.mjs), [page probes](../../scripts/qa/tenant-scoped-page-probes.mjs), [coverage inventory unit test](../../tests/tenant-isolation-coverage-inventory.test.mjs), [security workflow](../../.github/workflows/security-http-smoke.yml), and [second-pass notes](../qa/tenant-second-pass.md). Extend instead of replacing them. Preserve strict exit-on-error and fail-closed guards.
- New exported methods must have exactly one manifest record; unknown/new/modified handlers fail CI. **No manifest absence or method-status omission is a pass.** Public-by-design must have a reviewed method-specific reason proving no other-tenant private resource can be read or mutated. Implement `NEEDS OWNER` only with an actionable question, specific surface, owner assignee and reason; never silently convert GAP to a waiver.
- For COVERED, CI must resolve the exact linked existing test file/line and require the four components above; normal CI must execute that adapter in isolated real HTTP + PG, not just grep a helper name. To enforce this without falsely validating historical gaps, add proof-line and runtime receipts in each closure PR and re-audit the 76 earlier COVERED entries. Ensure each receipt is tied to method, attacker employer and victim PK. Unproven methods stay GAP.
- Add a programmatic headline counter guard for the consolidated manifest and [inventory overview](tenant-isolation-coverage-inventory.md); count 490 = COVERED + PUBLIC-BY-DESIGN + GAP (+ eventually NEEDS OWNER with question), verify the 20 page entries and the exact 406-method frozen queue. The historical appendices and old audit narratives remain explicitly historical, not current acceptance numbers.
- Run batches in parallel **shards** with isolated disposable PG16 databases and one localhost server per shard, keeping each job below the existing 20-minute budget. No sharing DB fixtures across parallel shards. Keep the default [Security HTTP Smoke](../../.github/workflows/security-http-smoke.yml) and normal `npm test` active on PRs. For each: `npm ci`, `npx tsc --noEmit`, `npm run lint`, `npm test`, Node inventory guards, production-mode security-http-smoke. Collect actual exit status and relevant log excerpts, never substitute expected output.

## Owner decisions / exploit response

If a real HTTP cross-employer leak is reproduced, create a stand-alone security finding with exact fictional IDs, request/response, victim DB before/after, impacted method and reproduction CI SHA. Fix minimally with the existing employer-access helper and same-PR regression. **If it appears exploitable on a live deployment, put that warning in the FIRST line of the PR and stop for owner triage** before rollout or further probing. Do not test live. Owner must decide external-provider-dependent methods where legitimate success cannot occur without provider calls, and any public-by-design auth/webhook route requiring signed-provider end-to-end acceptance. Suggested questions: can an **isolated fully fake provider adapter** prove legitimate success without network or money movement, or should this precise method be marked **NEEDS OWNER** pending approved staging? Is anonymous published careers access public while unpublished victim applications remain tenant-private? What exact redirect/403/404 is intended for each server-rendered page? Record each question per method; unresolved != COVERED.

## Completion criterion

All 490 current exported methods and all 20 page/action entries must resolve to **COVERED with executed four-part proof**, **PUBLIC-BY-DESIGN with an explicit method-level reason**, or **NEEDS OWNER with a concrete owner question**. Every case has a source- and CI-line-pinned evidence record. The manifest must remain **NOT ACCEPTED** until independent reviewer/owner acceptance. As of baseline: **406 API method GAPs and 20 page/action GAPs remain; 0 confirmed live exploits, no new fixes in this planning PR.**

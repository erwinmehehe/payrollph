# #188 vertical labor allocation dimensions — development review

This source candidate extends the **existing** percentage/hour-based employee labor allocations with nine optional accounting labels: campaign, site, team, plant, line, shift, property, department and event. These are **cost allocation codes**, not wages, time evidence, statutory calculations, staff permissions or new approval powers.

- Codes are strict uppercase ASCII 1–64-character labels, with unknown or malformed keys rejected instead of ignored; duplicate allocations incorporate every dimension in a tuple-safe key.
- All existing client/project/job fields remain untouched. The structured JSONB column defaults to SQL NULL, so old allocation rows retain their old meaning.
- The same validated labels flow to the resolved allocation, centavo-conserving expense splits, audit metadata and ledger CSV. Debit and credit/payable lines carry empty labels if not attributable; expense splits preserve the source dimensions.
- Existing journal headers remain unchanged for old data. Additional nine CSV columns appear **only if at least one stored allocation has new vertical labels**, because downstream Xero/QBO import mapping requires explicit review.
- No existing release/payroll/job mutation is performed by the code-writing action in this PR.
- The separate fictional two-attacker PG16 tenant-table test exercises all three POST actions (create cost center, GL mapping, effective-dated allocation) and the modified GET's actual returned tags. It requires own success, real higher-ID victim denial, forged worker/cost-center denial, and unchanged victim payroll/audit data; **only an exact-head passing run can substantiate its provisional manifest entry**.

## Review and go-live gates

1. **Do not merge or deploy this schema-dependent PR before** DBA verification of target, checked historical migration baseline and approved forward-only 0138 execution. Do not use a production db:push, run SQL through Next.js startup, or infer a completed migration from this PR.
2. Execute disposable PG16/18 schema + API negative tests, exact-head TypeScript, security and payroll journal regression, and check a populated two-employer fixture with real campaign/site and plant/line rows.
3. Independently review the new nine-column CSV format with finance integrations; validate exact debit/credit balance and legal-entity/tenant scope. Existing exports remain stable for data without new labels.
4. The existing Labor Costing panel now exposes a grouped optional vertical-code editor, duplicate validation, copy-latest support and a historical label column. Validate the editor with real desktop/mobile and multi-employer synthetic QA. Additional BI/report filtering and external Xero/QBO field mapping remain outstanding before closing #188. Existing production metadata is not altered.

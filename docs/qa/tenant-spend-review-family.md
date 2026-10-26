# Spend card metadata and expense-report rejection — tenant-isolation family

## Scope (separate from active family PRs)

This is a new, standalone two-method Spend family. It does not edit shared runner files, CI workflows, runtime routes, schema, or other families under review (People/platform, Workforce operations, Compensation, Employee Loans). The shared table loader discovers `scripts/qa/tenant-table-rows/write/spend-review.mjs` automatically.

| Manifest method | Positive synthetic control | Negative cross-tenant controls |
| --- | --- | --- |
| `POST spend` | An owner registers **fictional card metadata only** against their own worker and confirms exactly one new row and the actor-bound audit | Foreign employer selector returns 403; own selector with an actual victim employee ID returns 404 |
| `PATCH spend` | A different fictional maker submits a one-claim report; the owner **rejects** it, verifying the report, claim and audit change but no amount, card, transaction or report-item modification | Real victim report ID returns 403; adding a forged own `organizationId` cannot bypass the ID-derived employer guard |

Both rows use existing shared real-HTTP/disposable PG16 isolation controls: two independent attackers, a distinct higher-ID victim, same-origin authenticated requests, genuine own-state change, exact status, proof discrimination across employers, and byte-identical victim rows and audit history after denied requests. The family additionally snapshots every employer's Spend cards, card transactions, reports, items, claims and audit history. All identifiers and entities are fictional.

No provider is contacted. No reimbursement is approved, payroll posted, card charged, payout initiated or production flag enabled. **The positive report decision is rejection only.** The new focused Node tests verify that the expectations refuse unchanged, foreign, response-swapped or modified side-effect evidence.

## Verification and accounting

- Source-level check: `node --test tests/tenant-spend-review-family.test.mjs`.
- Required actual proof: run the existing default-profile tenant table workflow against disposable PostgreSQL and the production-mode localhost server on the **exact PR head**; require both new methods and all existing methods to pass.
- Preserve both manifest method statuses as **GAP** until a passing exact-head HTTP/PG16 receipt and reviewed evidence reconciliation exist. Do **not** claim two new COVERED methods from fixtures or source-level tests alone.
- On merge, reconcile in sequence with other active family PRs and rerun exact-head CI; do not stack or silently overwrite their manifest edits.

Global tenant-isolation acceptance and production release remain **NO-GO**. This proof is not production deployment or authority for financial actions.

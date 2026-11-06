# Tenant subscription start/cancel + year-end four-method proof

**DRAFT / FICTIONAL DATA ONLY / NOT MERGE-CLEARED / ZERO METHOD CREDITS.**

## Exact method scope

| Exact API method | Positive proof | Negative proof and invariants |
| --- | --- | --- |
| POST /api/billing/subscription/start | Two separate owned 201 sessions returned by a strictly local fake provider. Checkout remains awaiting_payment, subscription pending_payment. Duplicate requests reuse the same session. | Two authenticated owners receive real victim 403; no provider call or victim billing/payroll/audit change. Anonymous 401. |
| POST /api/billing/subscription/cancel | Two 200 cancellations after valid fictional password and local fake provider confirmation. Paid-through date preserved. Repeats are alreadyCancelled with no provider replay. | Real victim 403, wrong own password 403; victim unchanged, no invoice/tax/payroll mutation. |
| GET /api/year-end | Existing source-pinned full-method candidate: real own JSON, preflight, 2316 draft, 2316-print worksheet and Alphalist source; audit plus forged employee refusal. | Higher-ID victim 403, employee-employer join isolation and unchanged victim fiscal/audit rows. |
| POST /api/year-end | Existing source-pinned full-method candidate: unbound annualization and separately bound December 31 payroll run, real nonempty own SQL. | Two foreign owner 403s, forged victim payroll run 404, unchanged victim financial/audit rows. |

GET /api/billing/subscription is **not** among these four. It requires its own read proof and credit. Also excluded: year-end/prior-evidence, provider webhooks, official government filings and production processing.

## Fictional provider, no money

- The dedicated GitHub workflow starts fresh disposable PostgreSQL 16 at 127.0.0.1:5432/app_db and production-mode Next HTTP at 127.0.0.1:3000. Its three fictional employers include two independent owners and one genuinely higher-ID victim.
- Xendit billing is enabled only in the isolated test server so real code branches execute. The key is an unusable fixed ci-fictional-* fixture and the public application domain ends in .test. Payout, worker, real provider and email secrets remain absent/disabled.
- The dedicated Node preload intercepts the two reviewed Xendit session/deactivation endpoints, rejects unexpected provider endpoints, and blocks all external HTTP fetch egress. Its private /tmp receipt contains only fictional references and event kinds.
- The runner refuses unexpected credentials, environment flags, nonlocal SQL/server and a prepopulated organization database BEFORE imports. Own 201/200 and persisted state, foreign 403, row snapshots and dedupe receipts are hard assertions. A blanket denial or mock-only empty response cannot pass.

## Acceptance gates

1. Run the new tenant-billing-subscription-methods GitHub workflow against exact PR head, including isolated PostgreSQL 16 real HTTP.
2. Rerun the existing tenant-year-end-post-candidate workflow against that same head, plus JSON and atomic-rollback corroboration as needed. The year-end proof must include all GET formats and both POST action paths.
3. Verify current source hashes for every affected dependency. Any relevant source edit invalidates prior proof.
4. Obtain independent billing, payroll, security and privacy review of provider authority, cancellation behavior, tenant joins, annualization transaction atomicity, audit receipts and applicable CI/security results.
5. Only in a separate reviewed ledger reconciliation should accepted individual methods be promoted. Before that, year-end remains GAP/testedBy:null, **zero method credits**, and tenant/financial production NO-GO.

This PR changes no runtime route, schema, migration, default release flag, method coverage ledger or real provider credential. It performs no deployment, charge, cancellation, filing, transfer or customer-data access.

# PR #927 — A4 and A5 merged-source integrity checkpoint

**Development-only; read-only Git evidence.** The old 77-file A1–A6 runtime replay is retired. PR #927 intentionally changes only six workflow, test, script and documentation files; it does not publish, install, migrate or execute the A4/A5 feature stack.

## Current mainline ownership

- **A4 Spend/expense reimbursements PR #896** was squash-merged to main in commit `361bd6b5d9a9706a2930b0c48a8e0e431fd10bfe`.
- **A5 private employee 201-file vault PR #902** was **merged**, not left outstanding, in two-parent main commit `3a4a2edaca9a44064c824d57fcb3f9e88aee72c9` on 14 October 2026. Its first parent is `e0b4f83c44b1efe69dfbdd6f5d754441d463d02e`; its second is PR #902 head `3abd8a33918afe9089eeb99d50eb7130820eac12`.
- The vault document and upload release flags remain default OFF. Source merge is not production data migration, release activation or acceptance.

## What this read-only inventory verifies

`scripts/qa/a4-a5-source-inventory.mjs` runs only in explicit `CI=true`, `A4_A5_INVENTORY_MODE=read-only-ci`. The workflow pins the event's immutable base SHA, the **merged** #896 SHA, and the **actual #902 merge commit**. It never fetches or executes `refs/pull/902/head`.

The guard verifies that both merge commits are ancestors of the pinned main, and that #902 is a two-parent merge preserving the A4 predecessor history. It compares the **first parent of #902's merge** to the actual merge result to prove:

- The entire A4 Drizzle schema is byte-identical after removing the one reviewed `hcm_document_expiry_notices` A5 expiry-ledger block.
- The entire A4 COE/Spend retention scheduler is byte-identical after removing only the A5 private-object sweep import, call and return-counter additions.
- Critical release-flag source and the HCM deferred HTTP proxy are byte-identical across the A5 merge boundary.

The pinned **current main** is additionally inspected for A2/A3 predecessor tables, A4 expense policies and evidence, the A5 expiry table, all three COE/Spend/vault cleanup calls and counters, the explicit `DOCUMENT_UPLOADS_ENABLED` and `EMPLOYEE_DOCUMENT_VAULT_ENABLED` opt-in checks, and the `ENTITY_HCM_DEFERRED` proxy guard. Missing or altered source **blocks** the gate.

The isolated fixture suite covers passing two-parent merge, stale main, invalid merge SHA/ancestry, A2/A3 loss, A4 schema and retention regressions, removed A5 scheduler/table, security flag or HCM proxy drift, malformed references, and unsafe non-CI invocation. Historical A1–A6 preflight tests remain as *fail-closed* tests only. Sanitized SHA/boolean evidence is written to `qa-artifacts/a4-a5-source-inventory.json` with `MERGED_SOURCE_RECONCILED_ONLY` or `BLOCKED`.

## What this does not verify

This source inventory deliberately emits `combinedAcceptance: NOT_RUN`. It is not a combined A4+A5 PostgreSQL schema migration, private S3/R2/MinIO/malware-provider acceptance, real DPO/HR operations, payroll golden, direct-file upload, maker/checker sign-off, employee/device UAT, production deployment or release authorization. Independent executable tests belong to the mainline feature suites and must be evaluated separately from this source-only PR.

Keep private document storage/upload flags OFF until an independently authorized release process. No live employee PII, external-provider secret, payroll payout, live database write, production migration, CI approval spoofing or source-freeze bypass is needed for #927.

## Source-check freshness and merging

A green GitHub run only applies to its **exact #927 commit** and the event's **pinned base SHA**. The first A5 merge parent and the #902 merge SHA are immutable; main may advance after that event, requiring a new source check against a newly pinned main before any future merge. Do not substitute historical tests from an earlier head or remove ancestry checks for the sake of a green workflow.

The source-only PR can be reviewed independently of A5 because A5 has already merged. Keep the six-file diff and let the repository's normal protected-branch checks determine the actual merge decision.

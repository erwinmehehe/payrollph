# Tenant-isolation GAP batch factory — no automatic credits

**Status: planning and scaffolding only, NOT ACCEPTED as tenant-isolation proof.**
This implements a deterministic, conflict-aware work queue from the live route/method coverage manifest and the repo's AST-validated tenant-table read/write catalogs. It does not contact a database, a provider, a deployment or GitHub, and it does not edit coverage records or assert that a test has passed.

## Why this exists

As of initial source baseline `main@88d6e9a806932d09f716d02421cc2a9cc87a9a21`, the manifest records **498 methods: 293 COVERED, 195 GAP, 10 PUBLIC-BY-DESIGN**. Many GAP methods have a source row already written in `scripts/qa/tenant-table-rows/`; rewriting those tests would create waste. PR #1455 has already merged its independent employee-availability GET/POST proof, but both methods remain GAP until separate acceptance.

The batch factory always reads the **current checkout's** manifest, so these snapshot numbers must never be used as credit claims. It separates each current GAP into exactly one category:

- `reserved-evidence`: a known existing/merged proof awaiting acceptance (currently two methods from #1455; the two duplicate PRs have been consolidated by closing #1454).
- `existing-row-review`: an AST-validated read/write method row already exists, but the manifest still says GAP. **First inspect exact-head PG16/HTTP workflow results, fixture status and actual method assertion before proposing credits.**
- `new-proof`: no indexed table proof row yet. Group into domain/risk-sized batches for new method-specific fixtures and tests.

No GAP is counted twice. PUBLIC-BY-DESIGN and COVERED entries are excluded from the queue. A stale claim pointing at a newly covered method causes the source tests to fail closed until the reservation list is reconciled.

## Commands

From a checked-out repo with `npm ci` complete:

```bash
node --test tests/tenant-gap-factory.test.mjs
node scripts/qa/tenant-gap-factory.mjs --summary
node scripts/qa/tenant-gap-factory.mjs --json > /tmp/tenant-gap-queue.json
node scripts/qa/tenant-gap-factory.mjs --max 20 --summary
node scripts/qa/tenant-gap-factory.mjs --scaffold TQ-NEW-WORKFORCE-STANDARD-01 > /tmp/tenant-method-scaffold.mjs
```

Replace the example scaffold ID with the current `--summary` output; batch IDs are deterministic within one manifest snapshot but can change after credits are reconciled. A scaffold contains **one explicit throwing placeholder per method**, not a generated success path. It is deliberately non-executable as proof until a reviewer implements actual own-object and foreign-object checks.

## Fast execution protocol

1. **Verify existing sources before adding code.** Use the current manifest and planner to identify existing-row-review methods. For each, link an exact-head successful, isolated PostgreSQL 16 / real localhost HTTP test execution and verify the source row checks **populated owned evidence, two independent signed-in attackers, a real higher-ID victim resource, 403/404 denial, and unchanged victim DB/audit**. A 200 with no owned evidence, anonymous 401, feature-disabled 404, mocked request or source-only test does not qualify.
2. **Assign one family/domain batch per PR, 10–25 methods when compatible.** The default target is 16, but smaller tails must not be padded with fake proof. The queue proposes *new exclusive file paths* for each batch under `scripts/qa/tenant-batches/` and `tests/tenant-batches/`. Parallel PRs do not edit `scripts/qa/tenant-isolation-coverage-manifest.json`, the global inventory, table runner, shared proof credit writer, or other PR-owned proof files.
3. **Keep the strict runtime boundary.** Verify every method with fictional employer A and independent attackers B/C, dedicated `127.0.0.1:3000` production-mode Next, fresh disposable PostgreSQL 16 `127.0.0.1:5432/app_db`, temporary flags and no live credentials, production requests, migrations, financial provider calls or money movement. Reuse reviewed fixture/harness functions. For employee-only endpoints, include same-employer other-worker IDOR denials; for entity/path-ID methods, use genuine persisted foreign IDs.
4. **Run focused tests while developing, then required checks at the final exact PR head.** No source test or scaffold counts as successful HTTP evidence. Require independently reviewed method-specific positive and negative assertions and independent source review; production deployment is not acceptance.
5. **Credit centrally, after proof passes.** Once evidence is accepted, reconcile the manifest and inventory in one coordinated follow-up from the latest main. Remove the matching reservation(s), update exact method rows and counts with the required reviewed source anchors. Never auto-promote from this tool, a plan run, or a successful CI on another commit.

## Collision and safety contract

The reservation ledger `scripts/qa/tenant-gap-reservations.json` records **uncredited** methods with PR links and throws on duplicate claims, unknown methods and already-COVERED claims. The source catalog is loaded through `tenantFamilyCatalog()`, the same TypeScript AST-based validator the real tenant table uses. The emitted batch plan includes exclusive proposed proof file names and rejects any duplicate names.

This is a source-only workflow. It must never load `src/db`, import runtime route handlers, execute SQL, make network requests, toggle deployed flags or certify a tenant-isolation result. Future batch authors must keep all those safety properties in their *separate* executable proof workflows.

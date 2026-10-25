# Generate fictional write fixtures and probe proposals

This tool reduces fixture/body discovery work. **Zero coverage credits.** It changes no route,
money flag, tenant guard, database schema or coverage manifest. It does not replace the write
table's row-specific persisted-state `expect`, two-attacker/victim denial and discrimination proof.

## Offline generator (no database or server required)

```powershell
node --test tests/tenant-write-discovery.test.mjs
node --import tsx scripts/qa/tenant-write-discovery.mjs --plan
```

Read `outputs/tenant-write-discovery/plan.json`. For every currently GAP POST/PUT/PATCH/DELETE,
it includes the handler's JSON field reads, inferred scalar types/defaults, action literals,
possible feature flags, mutated Drizzle tables, required-column fixture proposal and unresolved
references. The catalogue records defaults/generated columns, enum options, unique constraints,
check names and composite FK mappings. TypeScript AST analysis is scoped to the selected method;
routes are read as text, never imported or executed. Arrow exports and destructuring work;
delegated/unsupported handlers and multipart bodies remain explicit holds.

The inventory is derived, not pinned to "132 writes". At preparation on `main@3a59f9a3c`, it
finds **185 GAP writes / 273 Drizzle tables / 10 initially eligible HTTP candidates**. #1382 is
still open and carries additional write credits. Once it lands, rerun rather than subtracting
an assumed count. Auth/jobs/webhooks are inventoried too; this tool does not classify them
PUBLIC-BY-DESIGN or decide their security contract.

Generated values are fictional proposals, not guaranteed valid business cases. Required FK IDs
must come from a fixture context: unknown IDs are listed, never replaced with guessed `1` or a
different employer's record. Defaults and generated IDs are omitted. Marker strings vary per
employer. Check constraints and uniqueness beyond the available metadata, helper-defined bodies,
policies, approvals, sealed documents and legal/employer prerequisites still need human fixtures.

## Probe execution — after #1382 merges

The new **Tenant write discovery** workflow runs offline planning/tests on PRs. Its write probe
is **manual, main-only**, with a check that #1382 actually merged into main and is an ancestor
of the checked-out source. It builds once, starts one server and uses a fresh disposable PG16
service with the existing isolated baseline. It is not automatically dispatched by this PR.

For a locally provisioned **empty, throwaway** `127.0.0.1:5432/app_db`, export the same fictional
profile environment as the workflow, keep worker/scheduler/providers OFF, set
`TENANT_WRITE_PROBE_MODE=fictional-disposable-only`, and run:

```powershell
node --import tsx scripts/qa/tenant-write-discovery.mjs --probe
```

Never use an existing developer database, Neon, Vercel, real employer or real provider credentials.
The probe refuses a nonempty organization table before seeding; it never parks, drops, migrates
or restores databases. Disposable fixture rows are left for inspection until the service is discarded.
It creates a new employer/owner/worker/session for each candidate and verifies the listening server
can read that employer's unique employee marker before issuing an HTTP write.

The initial bounded automatic selection covers simple HR/performance write handlers with one
explicit organization-scoped write table. Provider/auth/jobs, money/release paths, multipart,
ambiguous targets and approval/release/send actions are held. The hold is recomputed from source,
not accepted from edited plan JSON. Expand this selection only with reviewed source and tests;
do not remove the guard to make the probe count larger. Flags are hints; the tool never enables them.

`results.json` sorts **every inventoried row** into:

| Result | Meaning |
| --- | --- |
| works | HTTP 2xx accepted; not proof of a non-noop or persisted correct state |
| needs flag | 404/501 with disabled-flag hints; still requires checking the actual gate |
| needs fixture | unresolved references, prerequisite/conflict, authentication or permission gap |
| validation error | HTTP 400/422: refine the generated body |
| manual review | execution intentionally withheld, with reason |
| unavailable | timeout, rate limit or server/transport failure; never counted as success |

Reports contain no session cookies and redact URL/token-shaped errors. A 2xx response always
retains `persistedChangeVerified:false`, `isolationProven:false` and `coverageCredits:0`.
The tool does not call a foreign employer, assert DB effects, invoke a sealer, or award credits.

## Turn a cheap result into a real write-table row

Take its required-column fixture and body, replace unresolved domain references with owned fixture
IDs, then add the target runner's `state` and `expect`. Prove the exact persisted change for each
attacker, real victim-only denial, unchanged victim/audit rows and rejection of the other attacker's
genuine before/after data. Run the isolated workflow and review exact-head evidence before changing
the inventory. Keep each follow-up batch based on current main; no stacked PR is needed.

Observed here: offline planning and unit tests only. **Live probe NOT RUN**, pending #1382 and
the manual disposable execution. No production SQL, credential retrieval, provider or money movement.

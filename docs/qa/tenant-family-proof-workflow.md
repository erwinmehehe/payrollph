# Tenant proof families

The read and write HTTP runners load `scripts/qa/tenant-table-rows/read/*.mjs`
and `scripts/qa/tenant-table-rows/write/*.mjs`. Each family exports a `createRows`
factory receiving the existing fixture dependencies. Adding a family file needs
no shared registry edit. The offline catalog parses source without importing the
application or connecting to PostgreSQL.

This infrastructure moves the existing rows without changing their executable
bodies, method identities, profile flags or fixture order. It adds **zero method
credits**. Existing `fixtureOrder` maps preserve ordering across the move; new rows
may omit an order and run after existing fixtures in filename/source order.
Do not renumber the existing fixtures as part of a family batch.

The shared runner still requires two authenticated attackers, real own success,
victim denial, cross-employer proof discrimination and unchanged victim database
state. Writes additionally require persisted own changes and row-specific state
expectations. Family files cannot opt out of those checks. Unknown profiles,
disabled required flags, duplicate methods and invalid proof shapes fail closed.

## Develop in parallel, integrate sequentially

1. Branch each family batch from current `main` in a separate worktree. Inspect
   open PRs and assign distinct method keys before writing fixtures. Keep ordinary
   development confined to the family's read/write files and focused tests.
2. Reuse the generator and probe from #1383; see
   [tenant write discovery](./tenant-write-discovery.md). A probe's HTTP success
   is a candidate, not an isolation credit. Only ten initial bounded probe
   candidates were identified; there is no verified 60–90-method yield or delivery
   estimate. Actual fixture/probe results determine batch size.
3. Execute the real disposable HTTP/PostgreSQL profiles. Only after the exact
   method's proof passes, generate its manifest evidence **before merge** using
   `node scripts/qa/tenant-table-credit.mjs --run-label "<actual proof receipt>"`.
   This runs across the catalog: inspect every proposed new credit, and do not
   include another family's unexecuted rows. Previously reviewed evidence from
   another runner retains its provenance and is not double-counted.
4. Review the generated manifest and tracking document in that same PR. `file`
   and `line` identify shared own-positive execution; `rowFile` and `rowLine`
   identify the precise family method declaration. Own, foreign and unchanged-DB
   assertion pins remain in the shared runner. `--refresh-links` updates existing
   credits only, refuses GAP additions and preserves receipt/reason metadata.
5. Run tenant Node tests (including family parity, source inventory, count and
   script-count guards), TypeScript, scoped lint and `npm run tenant:repin:check`.
   Local checks catch regressions; actual HTTP/PostgreSQL CI on the final head is
   still required. Changes to family files trigger all three profile jobs.
6. Merge reviewed PRs one at a time. After each merge, sync the other family
   branches with main and regenerate/review their credits and proof pins. Re-run
   final-head CI. Never reconcile credits through unreviewed post-merge edits.

## Initial nonoverlapping work lanes

- **Performance:** `performance` family. Probe suitable plan/goal writes first;
  fixtures must prove persisted changes, not merely accepted HTTP.
- **People/platform:** `people` and `platform` families. Use the generator's
  bounded candidates and leave email/provider-dependent routes uncredited.
- **HCM/workforce:** `hcm` and `workforce` families. Separate governed state
  machines from simple fixtures; do not claim a missing prerequisite is success.

Check the current GAP manifest and open PRs before selecting method keys. The
identifier-review, payout-destination and remittance-action methods already have
open PRs and should not be duplicated. These are ownership lanes, not promises
about the number of methods that can be recovered.

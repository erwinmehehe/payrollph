# Tenant route edit impact report

The tenant coverage manifest pins each API route by the Git blob of the **whole**
`route.ts`. Any edit to the file, even one that leaves a method's own code
untouched, fails `tests/tenant-isolation-coverage-inventory.test.mjs` and puts
every provisional credit in that file back to "needs fresh proof". Until now an
author learned that from a red CI run: the first head of #2025 failed
`security-http-smoke` and `security-http-acceptance` that way.

`scripts/qa/tenant-route-edit-impact.mjs` shows the consequence **before** CI.

```
node scripts/qa/tenant-route-edit-impact.mjs --base origin/main
node scripts/qa/tenant-route-edit-impact.mjs --base origin/main --json
node scripts/qa/tenant-route-edit-impact.mjs --base origin/main --strict   # exit 1 if any credited method is in a changed route
```

For each changed `src/app/api/**/route.ts` it lists every handler with:

| Column | Meaning |
|---|---|
| state | `CHANGED`, `UNCHANGED`, `ADDED` or `REMOVED` handler text against the base |
| recorded | the method's status in the manifest (`COVERED`, `GAP`, ...) |
| meaning | what the edit means for that method |

It also reports whether **shared code** changed (imports, module config and
non-exported helpers). Shared code reaches every handler, so an untouched handler
is still told "shared code changed" when it did.

## What it does not do

- It is **read-only**. It never writes the manifest, never re-pins a blob and
  never renews or creates a credit. A test asserts the source has no write calls.
- It does **not** weaken the whole-blob rule. A handler whose own text is
  untouched is reported as "whole-blob pin still requires re-proof, reviewer may
  accept". That is information for the reviewer, never a credit.
- Handlers are found by their `export` header. The segmenter is tested against
  every one of the 295 route files in the manifest and finds exactly the
  manifest's methods in each.

## Worked example: the #2025 route edit

Commit `9d226f60b` edited `src/app/api/year-end/route.ts` to add a warning to the
POST response. The report for it:

| Method | State | Recorded | Meaning |
|---|---|---|---|
| GET | UNCHANGED | GAP | own code untouched (sibling-only edit) |
| POST | CHANGED | GAP | own code changed: needs fresh proof |

Credited methods at stake: **0**. Both year-end methods were already held at zero
credit (the transitive wage-source withdrawal), so the failure was the manifest's
blob pin drifting, not a lost credit. That is why the fix moved the warning into
`src/lib/year-end.ts`, which is not a pinned route. The report would have shown
this in seconds.

## Open decision for the independent security reviewer (not implemented)

A per-method pin (hash of each handler's own text plus a hash of the shared code)
would let a reviewer accept a sibling-only edit without re-proving every method.
This tool is the measurement half of that idea. The decision half changes what a
sealed receipt means, so it is **not** done here:

- A credited method's receipt would bind to handler text and shared-code hashes
  instead of the file blob.
- Shared code, including imports reached transitively (the wage-registry
  withdrawal is the precedent), must keep withdrawing credit.
- It touches the manifest schema, the inventory test and every `verify*Credit`
  helper, so it needs its own reviewed PR.

Until that is decided, a route edit still needs fresh proof and review for every
credited method in the file.

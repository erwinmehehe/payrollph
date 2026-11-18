# Why a calculation-only change withholds tenant proofs for dozens of routes

**Status: report only.** This document changes no guard, test, manifest, route or payroll
source and awards no credit. The only code added is a read-only evidence script
(`scripts/qa/proof-source-closure-report.mjs`) that grants nothing and is not a guard.
Fictional data only; money, payout, provider, CSP and calculation-history flags untouched.

Legend: **[V]** verified by reading the cited code or by running the cited command at
`origin/main` (`1b8d5e92b`); **[I]** inferred, with the reasoning stated.

## Short answer

1. There is **no automatic "this file changed, so these routes are stale" tool**. Staleness is
   enforced by several independent hash-equality guards. The one that withdrew 75 methods
   is a **single sealed receipt that pins a union of 668 files and verifies all-or-nothing**
   (`scripts/qa/wage-registry-renewal-verify.mjs:142-145`) **[V]**.
2. Of the 75 withdrawn methods, only **14** have any import path to the four files #2006 changed.
   The other **61** were withdrawn only because they share the receipt **[V]** (computed from each
   method's own route-plus-proof closure, median 56 files, against the receipt's 668).
3. Only **one** of the six changed source files (`payroll-engine.ts`) touches tenant data and takes
   tenant identifiers; four are pure calculation or data, and one (`payroll-finding-explanations.ts`)
   is pure except for a per-employer consent-allowlist check **[V]**.
4. The 75 were restored to GAP by **#2006 itself**, not #2017 and not a tool: #2006 changed the
   engine, added the exact reviewer `wage-registry-renewal-supersession.mjs`, and rewrote the
   manifest **[V]**. #2017 added 6 unrelated document holds (75 + 6 = 81) **[V]**.
5. Recommendation: **no tooling change now.** The 75 are already GAP, so a further engine change
   costs no additional credit today. Land the pending engine changes together, then adopt
   **per-method closure pins in the next renewal receipt** (option e). On the #2006 change this
   would have withheld 14 methods (8 with a pure-file allowlist on top) instead of 75.

## Held-method accounting, by PR (manifest at each merge commit) [V]

| Commit | Source files changed under `src/` | COVERED / GAP |
|---|---|---|
| before #1989 | | 461 / 0 |
| `7f69412ce` #1989 | `src/lib/wage-orders.ts`, `src/lib/statutory-rule-watch.ts` | 386 / 75 (47 transitive + 23 direct + 5 global seal) |
| `b852382ec` #2005 | **none** (scripts, tests, receipts, docs only) | 461 / 0 |
| `6c349677c` #2006 | `payroll-engine.ts`, `payroll-money.ts`, `payroll-assurance.ts`, `payroll-finding-explanations.ts` | 386 / 75 (same three kinds) |
| `1b8d5e92b` #2017 | `src/app/api/documents/route.ts`, `src/app/api/hcm/documents/route.ts` (the routes themselves) | 380 / 81 (75 + 6 document-metadata) |

The 81 held methods on main: 47 `wage-registry-transitive-dependency-source-withdrawal`,
23 `wage-registry-dependency-source-withdrawal`, 5 `wage-registry-global-source-seal-withdrawal`,
4 `document-metadata-legal-employer-source-withdrawal-zero-credit`,
2 `document-metadata-shared-security-source-withdrawal-zero-credit`.

## 1. How the tooling decides a proof is stale

There are four separate mechanisms, none of which is a general "changed file" detector.

**M1, per-route blob.** The manifest records `allApiRouteFiles[path].gitBlobSha` for each route
file only; guards compare it to the route's current blob. A route that itself changes is held.
This is why #2017's two route edits produced 6 document holds **[V]**
(`scripts/qa/tenant-isolation-coverage-manifest.json`; the audited re-pin tool
`scripts/qa/tenant-manifest-repin.mjs` only moves proof **line numbers** and never touches
statuses, route SHAs or claims, per its own header, lines 1-13).

**M2, the sealed union receipt (the cause of the 75).** `wage-registry-renewal-receipt.json`
holds `sourcePins`: the git blob of every file in a computed closure, 668 files
(src/lib 327, scripts/qa 219, src/app 61, workflows 32, src/db 3, other 26) **[V]**.
- *Generation.* `renewalInputRoots()` (`wage-registry-renewal-capture.mjs:12-29`) starts from the 75
  routes, their proof files and receipts, the executing workflows, and fixed roots
  (`src/proxy.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`,
  `drizzle.config.ts`, baseline SQL). `collectRenewalInputs()`
  (`scripts/qa/payroll-run-renewal-inputs.mjs:26-50`) follows every local `@/` or relative import with
  `ts.preProcessFile`, resolving `.ts .tsx .mjs .js .json` and `index.*`. It fails on any
  unresolved local import.
- *Verification.* `readWageRenewalReceipt()` asserts, for every pin, that the current blob equals the
  sealed one (`wage-registry-renewal-verify.mjs:142-145`: `Executed runtime/HTTP/source drift`).
  One drifted file invalidates the whole receipt, and the receipt backs all 75 methods **[V]**.
- *Type-only imports are included.* `ts.preProcessFile` returns `import type` and `export type`
  specifiers; I ran it and it listed all four of a mixed set **[V]**.
- *Excluded.* `ACCOUNTING_ONLY` (the wage-registry ledger scripts, `verify.mjs:51-`) and
  `RENEWAL_LEDGER_INPUTS` (`payroll-run-renewal-inputs.mjs:18-24`). The guard scripts
  `verify.mjs`, `plan.mjs`, `supersession.mjs` and the manifest are **not** pinned **[V]**.

**M3, hard-coded blobs in reviewers.** `wage-registry-renewal-supersession.mjs:14-15,28-29` asserts the
live `payroll-engine.ts` blob equals a literal `CURRENT_ENGINE_BLOB` ("Unknown payroll-engine source:
regenerate review evidence before changing credits"). So **every engine edit also needs a hand edit
to that guard file**. #2013 did exactly this in `0934b97da` (new `CURRENT_ENGINE_BLOB` plus
`IMPORTED_BENEFIT_PRIOR_BLOB`) **[V]**. Likewise `wage-registry-transitive-source-hold.mjs:8-13` pins
the archive hash and the exact `wage-orders.ts`/`statutory-rule-watch.ts` blobs **[V]**.

**M4, older global source seals (5 methods).** Their receipts sealed a whole historical source tree
(reason text: "full source-sealed proof does not cover the updated wage registry") **[V]**.

**M5, the import-closure inventory test** (`tests/wage-order-transitive-import-inventory.test.mjs`).
It is **hard-coded to two targets** (`wage-orders.ts`, `statutory-rule-watch.ts`, line 15), walks every
manifest route with a TypeScript AST breadth-first search (lines 36-80), **skips type-only imports**
(lines 48-54), and fails if a COVERED method reaches a target (line 110) or an internal import is
unresolved (line 109). It does not detect engine changes **[V]**. Non-literal dynamic imports are
collected but only printed, not asserted (lines 43 and 107) **[V]**; today there are 0 **[V]**.

## 2. Why #1989 and #2006 withheld about 75 routes

Routes reaching each changed file through runtime imports, from `proof-source-closure-report.mjs` **[V]**:

| Changed file | Routes / methods reaching it | Also only via type-only |
|---|---|---|
| `wage-orders.ts` | 51 / 72 | 0 |
| `statutory-rule-watch.ts` | 4 / 5 | 0 |
| `payroll-engine.ts` | 5 / 7 | 0 |
| `payroll-money.ts` | 5 / 7 (via the engine) | 0 |
| `payroll-assurance.ts` | 7 / 7 | 2 / 3 |
| `payroll-finding-explanations.ts` | 1 / 1 | 0 |
| `src/db/seed.ts` | 4 / 4 | 0 |

Three representative chains (all printed by the script **[V]**):

1. `src/app/api/approvals/[id]/route.ts` -> `src/lib/payroll-assurance-server.ts` -> `src/lib/wage-orders.ts`
2. **Via the seed:** `src/app/api/auth/login/route.ts` -> `src/db/seed.ts` -> `src/lib/wage-orders.ts`
   (login imports `ensureSeedData`, `login/route.ts:5`; the seed imports `WAGE_ORDERS`,
   `seed.ts:37`, and uses it at `:422` and `:508`). `auth/demo-switch` and `auth/me` take the same path.
3. `src/app/api/payroll-runs/[id]/process/route.ts` -> `src/lib/payroll-engine.ts` -> `src/lib/payroll-money.ts`
   and -> `src/lib/payroll-pre-run-readiness-server.ts` -> `src/lib/statutory-rule-watch.ts`.
   (Also `dashboard/route.ts` -> `dashboard-data.ts` -> `practice-payroll-server.ts` -> `payroll-engine.ts`.)

**Why 75 and not 14 or 63.** Scoring the 75 held wage-registry methods against each change **[V]**:
- #1989 files: **63** reach them (47 transitive + 16 direct). 12 reach none of the six changed files:
  the 5 global-seal methods (M4) and 7 "direct" methods on 6 payroll-run routes
  (`connected-impact`, `explain/[employeeId]`, `payout-reconciliation`, `pilot-signoff`, `variance`,
  `xendit-payout`) that have **no import path, runtime or type-only, to wage-orders, the watch or the
  engine** **[V]**. They were held on 2026-11-16 because their receipts executed the old wage source
  **[I]** (their reason text says the prior payroll-run receipts are historical).
- #2006 files: only **14** methods reach them. The proof harnesses add nothing: computing each method's
  own closure with the repo's `collectRenewalInputs` (route plus its proof file) gives the same 14
  (engine 7, money 7, assurance 10, finding 1; engine plus finding 8) **[V]**.
- So **61 of the 75 #2006 withdrawals were purely receipt granularity (M2)**, not import reach.

## 3. Is each chain tenant-relevant? Classes by changed file [V]

Classes: (a) reads/writes tenant-scoped data, (b) takes employer/tenant identifiers, (c) performs
authorization, (d) pure calculation on passed-in values. Evidence is the file's imports and token counts.

| File | Local imports | db/auth refs | organizationId refs | Class |
|---|---|---|---|---|
| `wage-orders.ts` | `critical-release-flags`, `payroll-rules` | 0 | 0 | **(d)** pure data and lookup (flags module reads `process.env`) |
| `statutory-rule-watch.ts` | `wage-orders` | 0 | 0 | **(d)** |
| `payroll-money.ts` | none | 0 (one comment says "never authorizes release") | 0 | **(d)** |
| `payroll-assurance.ts` | none | 0 | 0 | **(d)** |
| `payroll-finding-explanations.ts` | `automation-model-consent`, `critical-release-flags`, `payroll-assurance` | 0 | 2 | **(d) plus (b)**: takes `organizationId` for a consent-allowlist gate (`:16,:22`); keep tenant-relevant |
| `payroll-engine.ts` | `@/db`, `@/db/schema`, `drizzle-orm`, audit, 21 more | 10 | 68 | **(a) and (b)**. No session or role import, so authorization (c) is the caller's job |
| `src/db/seed.ts` | `@/db`, crypto, billing, provisioning | 67 | 69 | **(a) and (b)** (creates tenants; demo and first-run provisioning **[I]**) |

Pure (d): `wage-orders`, `statutory-rule-watch`, `payroll-money`, `payroll-assurance`.
Tenant-relevant: `payroll-engine`, `payroll-finding-explanations`, `seed`. #2006's chain includes the
engine, so a pure-file allowlist alone could not have prevented the withdrawal of the 8 methods that
reach the engine or the finding explanations.

## 4. Why the held set returned to GAP after #2005 credited it

Verified timeline (table above): #2005 changed **no** source file and credited all 75 from a fresh
receipt whose `sourcePins["src/lib/payroll-engine.ts"]` is `dc5719a2...`. #2006 then changed the engine
(`63fa2075...`) and four source files in total. In the same commit it added
`wage-registry-renewal-supersession.mjs` (+88), rewrote the manifest (-3,523 lines) and edited
`tests/helpers/tenant-counts.mjs` and `wage-source-holds.mjs` **[V]**. Mechanism **[V]**:
`readWageRenewalReceipt` fails on any drifted pin (M2), and `reviewedWageRenewalEngineWithdrawal`
permits **only** the exact COVERED-to-GAP demotion of the 75 recorded in the immutable inventory
(`supersession.mjs`; inventory blob pinned at `wage-registry-renewal-plan.mjs:9`). It was **#2006**,
not #2017 (#2017 left the 75 unchanged and added 6) and not an automatic tool.
**[I]** CI would have failed had #2006 not demoted: it follows from the drift assertion, but I did not
run the engine change against the old manifest.

## 5. Options that avoid re-withholding on every calculation change (no guard weakened)

Counts are computed **[V]** from each method's own closure over the 75 held methods.

| Option | How it works | Withheld if a #2006-style change landed later | Wrongly allows / how it could slip | Cost |
|---|---|---|---|---|
| **(a)** Reviewed allowlist of pure files the closure ignores | Closure skips listed files; a test fails if a listed file imports db, auth, session, crypto, fs or net | alone: **no help**, M2 is all-or-nothing; with (e): 8 (engine+finding; money and assurance ignored) | A pure file can change a result that a route then uses to scope data without importing anything; a file can gain `organizationId` logic or `process.env` flag reads while its imports stay clean. Needs AST bans on `process.env`, tenant-identifier params, `sql`, dynamic import, plus a per-file blob pin so every edit needs a reviewed allowlist edit | Small test; the **wage-orders** change (#1989) would drop to 0 held under (e)+(a) |
| **(b)** Typed data module (literals only) the closure treats as data | Move wage and rate data to a file that the AST check proves has only `export const` literals | #1989 case: 0 with (e); no effect on #2006 (logic, not data) | Cannot influence control flow, so it is the strictest of (a)-(c). Risk: logic creeping into the data file, caught by the AST rule | Refactor `wage-orders.ts` (9 exported functions, 51 reaching routes) |
| **(c)** Cut the `seed.ts` import | Extract `ensureSeedData` out of route-reachable code | negligible: `seed.ts` reaches 4 routes, 2 of them held | Dynamic `import()` with a literal still counts as an edge, so only physical extraction helps | Low benefit |
| **(d)** Do nothing, batch engine changes | Land all engine and money changes before one renewal | **75 now; 75 later per renewal** | None added (credit stays withheld) | One 42-job renewal per batch (#2005's run) plus a hand edit of `CURRENT_ENGINE_BLOB` per change (M3) |
| **(e)** Per-method closure pins in the receipt (new) | Each credited method binds to its own closure (route plus proof files, median 56 files) plus a **global base** (`src/proxy.ts`, `package-lock.json`, `tsconfig`, next config, `src/db`, `drizzle`, workflows). Drift withholds only methods whose closure contains it | **14** of 75 (63 of 75 for #1989) | Behaviors that are not import edges: DB triggers and migrations, middleware, env flags, non-literal dynamic imports, runtime file reads. The global base and the zero-unresolved and zero-dynamic assertions cover these | Receipt schema v2, so it needs a **fresh renewal run** to seal; v1 verification kept |
| **(f)** Per-family receipts | Split the one receipt by workflow family | between 14 and 75 depending on the family | Same as (e) at coarser granularity | Lower than (e), weaker result |

## 6. Recommendation, smallest safe change, rollback

**Make no tooling change in this PR.** I decided this on three grounds, all verified:
1. The 75 are **already GAP**. A further engine change withholds nothing additional today; the cost
   appears only at the next renewal, so there is no credit to protect by changing a guard now.
2. Options (a)-(c) cannot be applied to the union receipt without editing `readWageRenewalReceipt`, the
   guard itself. And (a) alone would not have helped #2006, because the engine is tenant-relevant.
3. The real fix (e) changes the receipt schema. It cannot be proven against real data without a fresh
   renewal, so adding it now would be unexercised verification code.

**Smallest safe sequence**
1. *Now (policy, zero code):* land the pending engine changes (#2013 and any others) **before** the next
   renewal, so one 42-job renewal covers them. Update `CURRENT_ENGINE_BLOB` once at the end.
2. *At the next renewal:* seal **receipt v2 with per-method closure pins plus the global base**. Keep v1
   verification unchanged. Required negative tests: the guard still fires when (i) a file in a method's
   own closure changes, (ii) a route changes, (iii) a global-base file changes (all methods withheld),
   (iv) a closure file gains a db, session or authorization import, (v) an import cannot be resolved,
   (vi) a non-literal dynamic import appears.
3. *Optional, later:* layer (a) or (b) on top with the AST bans above and per-file blob pins.
4. *Cheap tightening with no downside, any time:* assert zero unresolved internal imports and zero
   non-literal dynamic imports across `src/` (both are 0 today **[V]**), which the current inventory test
   only prints.

**Rollback.** v2 is additive and v1 verification stays. Rolling back means reverting the v2 receipt and
verifier PR; the 75 remain GAP (zero credit) throughout, so rollback cannot lower the guarantee.

## What was and was not verified

- Verified by running code at `origin/main`: all counts, chains, per-method closures, the type-only
  behavior of `ts.preProcessFile`, and the manifest history. Reproduce with:
  `node scripts/qa/proof-source-closure-report.mjs --held`
  (add `--json`, `--targets a.ts,b.ts`, `--routes route.ts` as needed).
- Inferred: why the 7 "direct" methods with no import path were first held; that CI would have failed
  without #2006's demotion; that `ensureSeedData` on login is demo or first-run provisioning.
- Not done: no proof was executed, no credit awarded or restored, no guard edited, no route or payroll
  source touched. The 81 held methods before and after this PR: **81 and 81**.

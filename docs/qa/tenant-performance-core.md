# Performance core: four provisional API method credits

This main-based batch covers only:

- `POST /api/performance`: cycle, template, cycle-template, company/team/employee
  goal and review creation.
- `PATCH /api/performance`: goal, structured review item, review progress and
  completion, and cycle completion.
- `PATCH /api/performance/calibration`: policy create/update, accept/resolve an
  outlier flag, scoring and finalization.
- `PATCH /api/performance/follow-through-governance`: reminder and evidence policy
  create/update, seal/verify, legal hold on/off and amendment.

The existing partial family rows remain unchanged and are not relabeled as
complete proof. A separate HTTP runner uses the shared three-employer fixture
helpers and performs 27 successful action scenarios per attacker. It checks actual
persisted targets and fields, signed-in actor audit evidence and unchanged pay
profiles/payroll runs. Each action denies an actual higher-ID victim employer;
applicable resource selectors additionally deny real victim IDs under the caller's
own employer. After every action and denial, all victim performance/business rows,
audit business fields and the shared core victim snapshot remain unchanged.
Every own action validator rejects the other attacker's genuine persisted result.

## Source defect reproduced and fixed

A company-wide administrator's team-goal POST previously accepted its own
`organizationId` together with another employer's existing `orgUnitId` and returned
201. Company-wide `assertScope` is not a tenant identity lookup. The POST now
requires the selected team row to match both ID and employer before scope checks
or insertion. The executable forged-unit regression reproduced the original 201
and now requires refusal. This is an own-row foreign-reference defect; no claim of
a production disclosure or leaked employee data is made.

The existing performance GET handler is byte-preserved and checked by digest.
Its independent proof provenance is retained; the inventory generator refreshes
only the whole-file source hash and actual handler declaration positions.

## Executed evidence and counting

See `tenant-performance-core-receipt.json`. Actual local disposable PostgreSQL
16.14 and a production-mode Next.js localhost server completed:

- 54 owned successful action calls, 54 victim-employer denials;
- 56 forged-reference denials and 27 cross-attacker discrimination checks;
- nonempty higher-ID victim fixtures and unchanged victim DB/audit evidence;
- mutation control: replacing the own-state verifier with a no-op makes the live
  run fail with `proof accepts another employer's data`; restore and rerun PASS;
- final positive proof rerun from a fresh task-owned database with restored source.

Credit generation is explicit and limited to these four keys:

```text
node scripts/qa/tenant-table-credit.mjs --performance-core --run-label "<receipt runLabel>"
```

The command verifies the executed receipt, exact action set, negative control and
source digests, then recomputes counts and overview rows. It does not promote the
other partial methods. Against the starting main inventory this proposes
341 → 345 COVERED and 147 → 143 GAP of 498; these are provisional PR counts, not
merged totals. Unrelated open workforce and credit-promotion PRs are separate.

## CI and safety

The default-profile disposable PG16 table workflow executes the independent runner
and uploads its sanitized summary. Exact-head CI and source/security review are
still required; local success is not production tenant-isolation certification.
The other existing profiles and shared runners retain their assertions.
No existing cited runner lines or another family's rows are changed.

The local server/database used task-owned ports 3013/5433 in a new cluster. The
pre-existing developer database on port 5432 was untouched. No Neon/Vercel,
production SQL, real data, real credentials, provider calls, published decisions,
payroll processing or live money flags were used. Reminder policies were disabled;
all ratings, holds and seals existed only in fictional fixture employers.

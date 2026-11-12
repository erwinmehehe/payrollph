# People SSR: enforce the multi-entity HCM embargo at the request boundary

**DRAFT / no additional tenant-isolation page or API credits / no production authorization.**

## Verified issue and narrowly scoped fix

The existing central Next.js proxy blocked `/hcm/*` and `/api/hcm/*`
while `MULTI_ENTITY_ENABLED=true`, but `/app/engagement` and
`/app/goals-reviews` are private HCM-adjacent pages outside those
prefixes. Both pages already independently validate membership, roles,
canonical employer selectors and single-legal-employer scope in their
normal feature-OFF flow. Their omission from the *multi-entity embargo*
was a route-policy inconsistency, not verified cross-tenant disclosure.

**Fix in `src/proxy.ts`:** include both People SSR route families in
the existing `multiEntityHcmRequestDeferred` check. Add explicit matcher
entries so even Next.js router prefetch requests cannot skip the embargo.
When multi-entity HCM is deferred, the proxy returns its existing
403 `ENTITY_HCM_DEFERRED` no-store response *before loading either page*.
The global CSP and existing HCM route protection remain unchanged.

The two sensitive page source files are **byte-identical** to the reviewed
main source-pinned blobs:
- `src/app/app/engagement/page.tsx`: `48132ee7356603136d7ac660086b3812ef28ed94`
- `src/app/app/goals-reviews/page.tsx`: `4989da5727ea5a55d0565fec6eb0af71cbb6046c`

The canonical 498-method/21-page tenant-isolation manifest and previous
independently executed proof receipts remain untouched. No historic
evidence was repinned and **the two page/action GAPs remain GAP**.

## Executable tests and guardrails

1. `tests/tenant-people-ssr-multi-entity-hold.test.ts` checks exact-true
   activation, feature-OFF parity, explicit request matchers (including
   prefetch), request-guard ordering and original reviewed page blob SHAs.
2. The existing `tenant-people-pages` PG16 job continues to prove
   actual feature-ON *single-entity* authorized owner pages,
   foreign/malformed/unit-only/revoked denial, owned survey API reads and
   unchanged fictional PostgreSQL rows. Its historical contract and
   HTTP runner are not weakened.
3. A **separate** `tenant-people-pages-multi-entity-hold` PG16 job
   builds the actual multi-entity-ON local Next.js server, seeds three
   real fictional employers with worker, performance-cycle and engagement
   records, and sends authenticated owner/foreign/prefetch, malformed
   and anonymous real HTTP requests. It requires the specific 403
   `ENTITY_HCM_DEFERRED` decision and private/no-store header, rejects
   all seeded employer markers, and compares ten employers' scoped table
   types across all three employers with byte-equivalent snapshots.
   It guards against remote DB, unsafe provider credentials, active
   payout/worker settings and non-fictional execution before DB import.

A queued or passing CI run is engineering evidence only. **All exact
final-head checks must pass** before a maintainer considers this for
review. Re-run after any later code revision.

## Excluded and acceptance pending

- [ ] Exact-final-head CI, isolated PG16 route proof, CodeQL and security smoke pass.
- [ ] Independent security and HR/privacy review of actual normal-route
      positives, multi-entity-ON 403s, prefetch behavior and SQL immutability.
- [ ] Separate tenant page/action coverage acceptance; do not alter GAP counts
      or historical source-pinned receipts from this bounded guard patch.

No live/Neon/production data, external providers, migration, payroll
calculation, payment, transfer, filing, feature rollout, deployment or
merge is authorized by this draft.

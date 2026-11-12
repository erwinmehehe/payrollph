# People SSR tenant isolation: early multi-entity HCM hold

**DRAFT / zero tenant-isolation page or method credits / no production or deployment approval.**

## Source-identified inconsistency

The existing `src/proxy.ts` multi-entity HCM embargo applies to `/hcm/*`
and `/api/hcm/*`, but private People SSR routes `/app/engagement` and
`/app/goals-reviews` are outside those route families. Their existing role,
membership, canonical employer selector, employee binding and
single-legal-entity checks do not replace the HCM-wide multi-entity
rollout hold. This is a policy-boundary repair, **not evidence of exploitation
or cross-employer data leakage**.

## Narrow runtime repair

Each SSR `page.tsx` now calls the existing `multiEntityHcmDeferred()`
**at the beginning of the page entrypoint**. On exact
`MULTI_ENTITY_ENABLED=true`, the request goes to `notFound()` (404)
before session lookup, employer metadata, private cycle queries or page
content. With multi-entity disabled, all existing feature flags,
membership, People role, employee binding, canonical selector, UI and
single-entity behavior remain unchanged.

The global proxy and existing `/hcm/*` and `/api/hcm/*` embargo remain
**byte-identical** to their original reviewed source
(`src/proxy.ts`: `8ed6591c4846cad3251bc1ee2444ceb3461b170a`).
No API handlers, database schema, payment, payroll, provider or worker
settings are changed.

## Current source versus preserved historical proof

| People page | Previous source blob (historical proof) | Current early-hold blob (pending review) |
|---|---|---|
| Engagement Survey | `48132ee7356603136d7ac660086b3812ef28ed94` | `6e84c87f63816042a847e4fbccfd970b84ceffa3` |
| Goals & Reviews | `4989da5727ea5a55d0565fec6eb0af71cbb6046c` | `13cc6239921d740cf984066e3cf716f752ec1371` |

The tenant-isolation manifest retains its original `reviewedUncertified`
and engagement `sourceRefreshCandidate` records without changing any
past receipt, owner approval or historical pass claim. A **separate**
`securityHoldCandidate` records the two new source blobs as pending
independent review, with **zero page/action/API credits**. The existing
16 page/action GAPs stay GAP.

## Required test evidence

1. `tests/tenant-people-ssr-multi-entity-hold.test.ts` checks the exact
   release flag and verifies that both page guards precede any session,
   employer or performance source reads. It pins the unmodified proxy.
2. The existing **single-entity, feature-ON** fictional PG16 workflow
   retains its real authorized own-employer page reads, foreign and
   malformed/duplicate denials, unit-only/revoked cases, survey API reads,
   and unchanged SQL snapshots.
3. The independent **multi-entity-ON** fictional PG16 workflow builds the
   exact PR head and requires 404 responses for authenticated own and
   foreign employers, anonymous requests and Next prefetch. It rejects
   private employer markers and checks protected SQL/audit snapshots.
   A 404 by itself is **not** complete employer-isolation certification.
4. The engagement employee privacy job must rerun against the updated
   page and contract source. Its employee participation and disclosure
   scenarios require exact source and actual synthetic HTTP/PG16 evidence.
5. Full CI, security HTTP, post-cutover smoke, CodeQL and independent
   security/HR privacy review must pass on the **same final PR head**.
   Tests and source refreshes do not retroactively validate historical
   receipts or authorize promotion of existing GAPs.

## Release boundaries

- [ ] Exact-final-head fictional PG16 feature-OFF and feature-ON proof pass
- [ ] Exact-final-head engagement employee privacy and full CI/security pass
- [ ] Independent security and HR/privacy review
- [ ] Separate page/action coverage acceptance (not granted by this PR)

No production/Neon database use, real employee data, payment, provider,
filing, live HCM feature activation, payroll execution, merge or deploy is
authorized by this draft.

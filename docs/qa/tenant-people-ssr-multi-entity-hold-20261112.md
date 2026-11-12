# People SSR tenant isolation: multi-entity HCM embargo

**Review state: DRAFT / no page or API credits / no production authorization.**

## Source-identified policy gap

The global Next proxy already fails closed for `/hcm/*` and `/api/hcm/*`
when `MULTI_ENTITY_ENABLED=true`. The separately routed
`/app/engagement` and `/app/goals-reviews` pages do not match that
route-family check. They use existing authenticated organization membership,
company-wide People role/custom-permission policy, canonical selectors and
`singleLegalEntityForTenant` safeguards. These are useful protections,
but a single legal-entity row is not approval to bypass the global
multi-entity HCM rollout embargo.

In particular, the Goals & Reviews SSR page selects real
`performance_cycles` rows for its authorized parent organization.
This is a source-identified **inconsistent feature boundary**, not an
assertion that production data has leaked or that cross-organization
authorization was bypassed.

## Narrow runtime repair

Both SSR entrypoints now call the existing
`multiEntityHcmDeferred()` guard **before** retrieving the session,
resolving an employer, querying any private source, or rendering a client
shell. Multi-entity enabled: return the normal not-found page. Multi-entity
disabled: preserve the existing flags, membership/role/permission checks,
canonical selector rules and employer-specific data queries.

No source API, schema, environment flag, payroll calculation, worker,
payment/provider route, or protected tenant manifest is changed. The global
`/hcm/*` proxy embargo is preserved.

## Verification and acceptance

Focused source and policy regression:

```sh
npx tsx --test tests/tenant-people-ssr-multi-entity-hold.test.ts
npm run typecheck
npm run lint
```

The regression validates exact-true flag behavior, the early route
refusal and retention of canonical employer parsing. It is **not** a
live browser or PostgreSQL tenant-isolation test.

Before any approval or page-status promotion, run an **exact-final-head**
disposable PostgreSQL 16 production-mode local HTTP check: both routes
feature-ON with `MULTI_ENTITY_ENABLED=true` must deny authenticated
company-wide owner/HR sessions before private SSR data; feature-OFF
authorized own-employer reads must still work; foreign, malformed/duplicate,
unit-only and revoked session requests must remain denied; verify no private
markers in HTML/RSC and unchanged database/audit snapshots. Run applicable
full CI, security checks and independent privacy/HR review.

**Zero tenant-isolation credits.** Existing page/action GAP statuses,
owner approvals and source-pinned historical receipts remain unchanged.
A test or merge is not authority to enable multi-entity HCM, production,
payroll releases, providers, transfers or deployments.

# Multi-entity context-switch tenant isolation: provisional proof

**Status: DRAFT / NOT ACCEPTED / NO COVERAGE CREDIT.** The authoritative
coverage manifest marks `PATCH /api/multi-entity/context` as **GAP**. Its
existing `GET` method is **COVERED**; this PR changes neither status.

## Exact action under test

`PATCH /api/multi-entity/context` with an explicit *single* legal employer
selection, on the existing `multi-entity` profile with `MULTI_ENTITY_ENABLED`
enabled only for a synthetic local server. The route writes a per-user
selection preference, **not** an employer grant, transfer or payroll change.

The shared write-table runner seeds **two independent authenticated owners**
plus one genuinely persisted, higher-ID victim organization and legal entity.
It validates all of the following against real localhost HTTP / disposable
PostgreSQL 16, without accepting a feature-disabled 404 or empty own success:

- **Own PATCH:** signed-in owner explicitly selects an entity *actually granted*
  inside their own employer. Expect `200` with exact `legalEntityId`; confirm
  exactly one new actor/tenant/entity-bound preference and one matching audit
  record, with pre-existing audit, grants and legal entity master data unchanged.
- **Foreign employer:** same signed-in owner selects the *actual* victim employer
  and victim legal-entity ID. Expect `403`, no victim identity disclosed, and
  no change to either employer's business data or audit.
- **Forged entity reference:** same owner names their own employer but the
  victim employer's *real higher-ID* legal-entity ID. Expect `403`; no new
  preference, modified grant or audit for either employer.
- **Discriminating owner assertions:** the second owner's check must reject the
  first owner's genuine response/state. No made-up victim IDs, anonymous-only
  denials, mocks, or feature-off results qualify.

The runner independently snapshots the victim's core organization, workers,
units, legal employers and audit; this family additionally snapshots *all*
employer preferences and user-to-entity grants, source entities and audit.
Pure negative-control tests deliberately reject a no-op, other-owner write,
wrong/foreign ID, altered prior rows, extra audit event or grant change.

## Limits and acceptance

This is **one GAP PATCH method** and not proof of group-HR `all` selection,
multiple entity grant switching, role downgrades, revocation races or all
`multi-entity` endpoints. No credentials, payroll execution, provider,
production data, live migration, schema change, production authorization or
money movement is involved. The exact-head focused synthetic PG16/HTTP job,
shared multi-entity profile, broad repository checks and an independent
security/maintainer review must all succeed before a separate evidence and
coverage decision. Never change the manifest or claim certification here.

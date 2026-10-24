# Multi-entity selector consistency — fail-closed boundary (draft)

## Security scope

The shared `resolveMultiEntityContext` helper previously chose a supplied
`requested` value before `x-legal-entity-id`, and chose the header before
`?legalEntityId=`. It did not detect contradictions. A downstream route that
accidentally consumed a different selector could become a confused deputy,
even when this shared helper authorized only the chosen employer.

With `MULTI_ENTITY_ENABLED=true`, this change:
- Reconciles the explicit request argument, header and **all** query values
  before loading employer/grant/preference tables.
- Requires a canonical safe positive decimal legal-employer ID; accepts the
  explicit `all` only subject to the *existing* group-HR policy.
- Rejects conflicting selectors with HTTP 403 `ENTITY_SELECTOR_CONFLICT`.
- Rejects invalid/duplicate selectors with HTTP 403 `ENTITY_SELECTOR_INVALID`.
- Keeps a saved preference as fallback only when **no** explicit selector exists.
  A revoked grant or incorrect explicit employer never silently becomes another
  client's chosen employer.
- Retains the existing role, current-grant, active-primary and employer-resource
  checks. The policy still prohibits cross-employer `all` for normal
  owner/admin/bookkeeper/hr/payroll roles.

With the feature flag OFF, the shared resolver returns through its original
legacy branch before parsing request selectors or querying the new tables.

## Evidence and review

- `tests/multi-entity-selector-boundary.test.ts` covers canonical selection,
  malformed numerics, duplicate `legalEntityId` parameters, mismatched
  argument/header/query combinations, existing-grant policy and feature-OFF
  source ordering.
- `tests/multi-entity-isolation-db.test.ts` extends the existing *disposable*
  PostgreSQL multi-tenant fixture with authenticated role/grant context and
  actual `Request` objects. It verifies an owned matching selection remains
  available, while conflicting same-tenant and foreign-tenant selectors are
  denied without echoing an employer ID.
- Run `npm run typecheck`, `npx tsx --test tests/multi-entity-selector-boundary.test.ts`
  and the existing isolated PostgreSQL regression suite on the **exact PR head**.
  No new deployment flags, migration, external providers, filing or payment.

**NOT ACCEPTED:** This is a shared authorization guard, not independent positive
HTTP evidence for every API method. Do not convert any of the current method
GAPs to COVERED on the strength of pure tests or in-process PostgreSQL checks
alone. Downstream resource-ID routes must still verify actual resource
ownership, employer attribution, victim-only denials and unchanged snapshots.
Independent security-owner review is required before merge.

# OIDC linked identity: provider-employer authorization boundary

The follow-on [identity-write boundary](tenant-oidc-identity-write-boundary.md) adds production transactional rechecks, actual callback dependency-double regressions, and a separate real-PG16 concurrency fixture. It preserves this PR's organization-scoped identity lookup and read-only negative proof. The new fixture observed 4 legitimate writes, 14 denied writes and an in-flight membership revocation; it is not an IdP-over-HTTP login receipt and grants zero credits.

## Source-identified risk

The SSO callback formerly retrieved an external identity by globally unique provider ID and subject without also checking the persisted linked identity's organization ID. Those tables have independent foreign keys; an inconsistent or stale link pointing at the correct provider from another employer must not be treated as an authorized sign-in link.

The previous implementation also updated a linked identity's `lastLoginAt` before verifying the user's current active workspace membership and effective MFA requirement. Denied SSO sign-ins must not update linked identities or create login sessions.

This is a preventative source-boundary fix, **not** a report of observed exploitation or a production data breach.

## Implemented

- Require provider organization + provider ID + subject in the external identity lookup.
- Repeat the provider-organization and subject predicates on the linked identity update.
- Postpone both existing-link timestamp updates and new-link insertions until after active membership and MFA checks.
- Preserve session generation and the existing OIDC browser-state, provider-domain and expiry checks.

## Evidence and limitations

- `tests/tenant-oidc-browser-state.test.ts` checks guard order and scoped identity predicates.
- The existing isolated PG16 + real localhost HTTP workflow includes an extra test-only contradictory `external_identities` row for a different employer with A's provider ID. The historical unscoped lookup finds the row, whereas the new organization-scoped lookup rejects it. A legitimate same-employer linked row remains selectable. The negative SQL snapshot verifies lookup-only behavior.
- This fake PG16 proof intentionally has **no valid IdP credentials, token exchange or completed SSO login**. It proves the DB lookup boundary and the independent browser-state HTTP cases, not a full callback success after a provider token.
- The callback route stays an **uncredited GAP** with no new tenant-private API method credit or production certification. The 498-method / 21-page inventory counts are unchanged.
- Independent identity/security review, an isolated provider-token full-flow positive, and exact-final-head CI are still needed.

No migrations, deployment, production flags, worker operations, external payment providers or live identities were touched.

# HR Cases — employee POST, COE retrieval and hydrated staff browser (test-only)

Tracking: [#1966](https://github.com/erwinmehehe/payrollph/issues/1966).

## What this focused disposable proof adds

- PostgreSQL 16, localhost production-mode Next, fictional test-only users and workers; zero real data or provider calls.
- Two independent employee identities create real own-employer HR cases while deliberately supplying victim organization, employee, creator and role hints. The persisted case and audit must bind exclusively to the logged-in employee. Staff-only owner POST and anonymous POST refuse.
- Three separately seeded fictional HR case collections include a real higher-ID victim. Two owned clean *synthetic* COE document bodies may be retrieved by their own linked employee and authorized staff. Both independent attacker employers must receive 404 for foreign case-linked document IDs with unchanged victim SQL and audit.
- The staff HR inbox is hydrated in real Chromium, showing its own case rows, internal notes and the exact persisted COE document link, without foreign data. Posting a real internal note through the UI updates the own source while the employee-facing inbox stays free of that internal note.
- The original signed-in employee and staff sessions stay authenticated after their memberships are revoked, but previously available COE IDs and new employee submissions must immediately deny.
- Existing HR Cases GET/PATCH dedicated PG16 suites remain in force; this proof is complementary, not a duplicate or a new method credit.

## Still not proven

- No actual COE issuance, external object storage, signer/provider or maker/checker workflow is exercised. The COE body is an explicitly **synthetic pre-approved fixture**, not a generated live document or certificate approval.
- Multi-legal-employer COE document grants under one parent organization are not covered by this feature-off, single-employer profile. They require a separately enabled and source-pinned test, and any corresponding security fix needs independent review.
- Not every role, group-HR, historic case mutation, browser cache race or direct document download after policy changes is covered. A separate multi-entity PG16 suite and PATCH suite already exist; reconcile their actual current-source evidence before broader acceptance.
- HR Cases page remains **GAP**; method/page credits stay unchanged. Passing synthetic tests and solo-maintainer review are not production security/privacy certification.

This PR modifies only QA scripts, tests, workflow, and documentation. No live route, tax/payroll calculation, database schema, provider integration, feature default, secret, migration, or tenant coverage ledger is modified.

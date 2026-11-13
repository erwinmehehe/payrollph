# Report Builder POST isolation candidate — zero credit

Scope: the actual /api/reports/builder POST JSON preview and CSV export, not the already tested SSR GET shell. The related independent acceptance queue is issue #1966.

## What is actually exercised

- The job checks out the exact PR head, verifies eleven immutable production/fixture source blob hashes, refuses non-disposable targets and provider credentials, and requires empty PostgreSQL 16 localhost data.
- Six fictional filler employers, two independent signed-in attacker employers, and a higher-ID populated victim are seeded using the existing tenant fixture helper.
- Two nonempty own-employer JSON previews and two actual CSV export responses must include the persisted own unit and headcount, with exactly one own-employer CSV audit row each.
- Both attackers request JSON and CSV exports from each foreign employer; all eight requests must deny without victim markers or a changed foreign database/audit snapshot.
- Invalid IDs, unsupported output modes/fields, anonymous access, a unit-scoped HR account and a revoked active employer grant must refuse without unrelated data.
- Negative contract tests reject fake success payloads, blank CSV, missing provenance, unsafe environments and modified source pins.

## Deliberate limits

- This is a zero-credit synthetic HTTP candidate: no API method status, page status, manifest, historical receipt or review decision is modified. Report Builder page remains GAP.
- This does not exercise an actual hydrated browser or guarantee A-to-B-to-A UI stale-response isolation; that remains an outstanding issue #1966 review scenario.
- It does not test multi-legal-employer write grants, all historical payroll attribution cases or administrative role permutations. Separate current-source proofs and independent privacy/security review are still required.
- The existing GET API uses a single parsed query parameter; duplicated and noncanonical selector behavior is not certified by this POST-only suite and needs its own review before complete page/API acceptance.
- No production data, provider calls, real payroll release, money movement, feature-default change, deployment, merge or government submission. No claim of complete tenant isolation.

Acceptance: require a passing complete workflow on the final reviewed head, source-consistent result logs, and explicit independent security/privacy and maintainer sign-off before any separate credit proposal.

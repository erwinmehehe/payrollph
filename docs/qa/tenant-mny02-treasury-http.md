# MNY-02: Treasury-controls POST isolated employer policy proof

**Scope: one exact GAP method:** POST /api/treasury-controls.
**Batch:** MNY-02, money-operation policy administration, not the active PII-01, PII-02, WRK-01 or HCM review families.
**Baseline:** main 03e5f389d962dec5cd5eb9ab4fcdeaaa9bb976a8.
**Route blob:** bb5b9cd2b0a0ca2d9ec3d66bfab80ebdf344d653.
**Coverage:** zero method credits. The authoritative main manifest and all previous receipts are unchanged. This is a review-only proof candidate and does not certify any live money action.

## Why this is independent

Open PRs at creation were #1521 (employee wage region), #1523 (four PII/WRK method credits), #1524 (ESS self-profile PATCH) and #1526 (HCM manager-attestation POST). No related MNY-02, treasury-controls or overlapping route PR was open. The reservation ledger had no entries. This PR does not touch those families, their files, coverage counts or work queues.

## Disposable real-HTTP coverage

The workflow builds Next.js in production mode over a brand-new PostgreSQL 16 app_db. The process requires exact loopback URLs, GitHub Actions, fictional-only mode, verified session MFA, and empty organizations before seeding. All payout, billing, workers, hosted DBs, outgoing provider credentials and production integrations are disabled. The metadata domain is an example.test placeholder, never contacted.

It creates two independently signed-in owners from different fictional employers. Six more fictional filler employers ensure the real victim organization, employee, owner and operator all have IDs above six. The victim gets a genuine persisted enabled policy and bookkeeper operator by calling the same production-mode POST endpoint before any attacker tests. The audit and victim policies are snapshotted.

For each attacker employer, the suite checks:
- A genuine own policy save with owner MFA, two distinct release/operator users, persisted treasury policy, active operator assignment and one matching business audit event.
- Exact foreign-employer 403 when the same signed-in owner supplies the real populated victim organization and its real operator ID.
- Exact 400 for a real high-ID stolen victim operator or another employer's bookkeeper within an otherwise own request.
- Exact 409 when the only selected treasury operator is also the release-capable owner, preserving separation.
- Same-company bookkeeper 403, missing-owner-MFA 403, unsupported action 400, revoked-owner-membership 403.
- Fake victim organization and operator selectors in the query/body cannot change the effective company; the real persisted own policy and audit must remain bound to the signed-in owner.
- Enabled policy, disabled policy, and re-enabled policy with separation explicitly turned off. When a real fictional pending payout-destination change exists, disabling fails 409 with no policy/audit changes.
- Real database before/after snapshots of the victim's treasury policy, assignments, membership, staff, payroll, pending payout requests and business audit remain byte-for-byte unchanged during every non-victim action.
- A separate already-covered GET may read back the own policy, but this PR does NOT claim a new GET method credit.

The contract suite mutation-tests refusal modes, forged success, omitted audit, wrong organization IDs, operator scope changes, mutated payroll, leaked private headers, or false response timestamps.

## Strict acceptance boundary

This proof may only be marked successful when its exact final-head PostgreSQL 16 + localhost HTTP GitHub Actions run is green. No fictitious acceptance or coverage promotion is claimed. Before any future change from GAP to COVERED, review the full POST action surface, actual CI logs, four distinct source-line anchors, source hashes, negative mutation tests and unchanged victim SQL, with independent security/payroll owner signoff.

No application handlers, migration files, business records outside disposable CI, payment providers, payout credentials, banking fields, production feature flags, releases, or financial movements are changed. Keep this PR draft and do not merge it as a blanket tenant-isolation certification.

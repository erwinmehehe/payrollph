# PII-02 self-profile PATCH — final-head payroll-entry evidence

## Scope and PR ownership

- Exact method: `PATCH /api/self/profile`.
- Existing frozen batch: **PII-02**. No open pull request among #1712, #1727, #1728, #1729, #1730, #1731, and #1736 owns this method.
- Starting base: `main@9fb1ddd79a7517085097dae4d0e66e2552efc0f9`.
- One family, one route and one HTTP method. Prior source fixes and the original SHA-pinned historical #1518 proof remain unchanged.
- Repository has one owner, `@erwinmehehe`. No second reviewer exists. If and only if a full exact-final-head proof passes, label its evidence `SOLO_VERIFIED_DEV_RECOVERY`, with the repository owner as sole reviewer.

## Four-part real-HTTP proof

The existing dedicated GitHub Actions workflow starts a new disposable PostgreSQL 16 database and a production-mode Next.js server on 127.0.0.1. It executes `scripts/qa/tenant-self-profile-atomic-http.mjs`, not a mock.

- Genuine positive: two independent signed-in employee accounts each PATCH only their own persisted mobile and emergency contacts, with actor-bound audit rows. The higher-ID victim employee also independently demonstrates a valid own write.
- Real victim denial: anonymous/nonemployee 401/403 and same-session revoked or mismatched employee membership 403; genuine high-ID victim identity never becomes the caller's effective worker.
- Victim unchanged: the victim's full employee, membership, contact, audit, payroll and recovery snapshot remains unchanged after every attacker action. This PR additionally requires **one real payroll entry seeded for each employer** and verifies joined `payroll_entries` SQL data through the actual employer-bound payroll runs.
- Forged selectors: genuine victim and same-employer coworker IDs in both JSON and query are ignored by the self-profile route. Expected HTTP 200 must update **only** the signed-in caller's contact; other employees, including the victim, remain byte-identical. Unsupported money and payroll selector-only payloads must return HTTP 400 without mutation.
- Atomicity: existing disposable audit-trigger failure must roll back both contact and audit; no partial write.

This PR also fails closed unless `NEXT_CSP_ENABLED=false`, and explicitly sets that value in the dedicated workflow. Worker, scheduler, billing, payout and provider controls remain disabled.

## Credit and release boundary

**Draft / zero new method credits.** Main's `PATCH self/profile` remains GAP with `testedBy:null`. Previous merged source security work or earlier proof runs do not count as a new final-head pass. Only passing all four proof parts on this exact PR head, then reconciling manifest, ledger, pins and metrics followed by a second exact-head verification can justify coverage credit. Any failed check stays zero credit with its failure reason.

No production database, Neon, provider API, real contact/payroll data, deployments, money movement, CSP enablement, migration or release flag changes. Do not merge.

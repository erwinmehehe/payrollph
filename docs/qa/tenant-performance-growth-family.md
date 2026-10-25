# Performance growth: nine pending exact-method proofs

This is a fresh main-based batch, separate from the three Performance follow-up
credits in #1402 and the HCM scenarios in #1404. All nine methods remain GAP until
actual HTTP/PostgreSQL acceptance. Source tests and prepared fixtures are not
coverage credit.

| Method | Exact own operation |
| --- | --- |
| POST performance | Create an employee goal |
| PATCH performance | Set a seeded employee goal's progress to 40% |
| POST performance/competencies | Create an own profile/skill requirement |
| PATCH performance/competencies | Revise a seeded requirement's proficiency and mandatory setting |
| POST performance/continuous | Schedule an own employee meeting |
| POST performance/development-plans | Add a milestone and its event to a seeded plan |
| POST performance/calibration | Open a session and copy one synthetic completed review into an unrated entry |
| PATCH performance/calibration | Create a calibration distribution policy and version event |
| PATCH performance/follow-through-governance | Create a disabled reminder policy and version event |

The existing loader discovers the new `performance-growth.mjs` family. Original
family bodies, fixture ordering, curated proof provenance and shared acceptance
controls remain intact. The runner exercises two independent attacker employers,
real higher-ID victim targets, forged foreign references where the method accepts
them, discrimination and unchanged victim database/audit plus row-specific state.

Each own proof binds the actual response to persisted employer, row identity and
domain values. It rejects no-op writes and unrelated row mutations. Milestone and
calibration creation must preserve the source plan/review. Milestone/policy events
must belong to the own employer and actor, match the affected target/version and
carry the recorded snapshot. Calibration entries must reference the seeded review
and original score; no calibrated/finalized rating is claimed. Policy responses
omit employer/row IDs by design, so their exact snapshots are checked against the
scoped database row and actor-bound version event instead.

Fixtures use fictional employers, skills, workers, completed review evidence and
future meeting/deadline dates. Reminder policy and both notification options stay
disabled. No scheduler, email, provider, salary decision, production SQL, Neon,
schema migration, money flag or tenant/audit guard is changed. Coverage is bounded
to these scenarios, not every action branch, manager role or multi-entity mode.

Acceptance: inspect the exact-head default HTTP/PostgreSQL logs for all nine rows
and all three table profiles; fix failures; then generate reviewable credits for
the successful exact methods and require fresh CI on that final head. Link-only
refresh adds zero credits. This PR is not authorized for automatic merge.

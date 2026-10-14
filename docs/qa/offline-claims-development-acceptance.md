# Offline claims — synthetic migration and operational-development acceptance

**Scope:** Post-merge engineering verification of source PR #976. Offline attendance remains disabled in every production environment. This is NOT a production migration, an independent human UAT signoff, a live employer payroll rehearsal, biometric verification, or permission to clock in/out automatically.

## Exact SQL source and immutable rollout boundary

Source: `docs/engineering/migration-proposals/offline-punch-claims.sql` (unnumbered and **NOT FOR PRODUCTION**). Run `Offline Claims Isolated Migration and Mobile Acceptance (No Money)` from GitHub Actions, whose `exact-sql-rollback` matrix creates separate **disposable PostgreSQL 16 and 18** containers.

The script `scripts/qa/offline-claim-proposal-rehearsal.mjs` refuses to run unless `CI=true`, `GITHUB_ACTIONS=true`, `OFFLINE_CLAIM_MIGRATION_REHEARSAL_MODE=isolated-ci-only`, and the database is `postgresql://...@127.0.0.1:5432/app_db`. It requires all relevant application tables to be empty, and does not use Neon or any remote host. It executes the **exact bytes** of the SQL proposal in a one-time scratch schema inside a transaction. It checks actual public employee/user/employer foreign-key compatibility, tenant composite FK, idempotent-event uniqueness, the permitted status/action CHECK constraints, and the absence of biometric and payroll fields. All fake records and the scratch schema are **rolled back**, and the script verifies zero residue after rollback. A second application must be rejected rather than silently treated as a migration-history receipt. It outputs the proposal SHA-256 and a sanitized result, but no employee data or SQL secrets.

The `synthetic-employee-hr` job runs against a different ephemeral local PostgreSQL instance. It temporarily enables `FACE_OFFLINE_PUNCH_UI_ENABLED=true` **only inside that GitHub Actions job**, leaving `MULTI_ENTITY_ENABLED=false` and all money movement and evidence-photo flags OFF. It creates fictitious employers A/B, worker accounts A/B, HR A, payroll A, and owner B. It uses real login-session HTTP requests to verify:

- Employee submission requires the account's own worker ID, acknowledged unverified evidence, a seven-day/future-skew bounded timestamp, and the proper employer.
- Separate employers cannot read, submit or review each other's claims. A payroll operator cannot impersonate HR. HR review is distinct from the employee maker.
- Identical client event retries return the same claim without a second audit; changed actor/action/time is rejected. Forged or duplicate review is denied.
- HR can flag/dismiss only a pending claim, with an audit entry. Neither action creates a `time_punches` entry, payroll run, money transfer, biometric photo or agency submission. Malformed PATCH JSON returns HTTP 400.
- A second app on localhost port 3001 with `FACE_OFFLINE_PUNCH_UI_ENABLED=false` must show the route as unavailable and hide the UI.

Synthetic Chromium verifies **320/375/390/430px** layouts. It tests explicit camera consent and denied-permission/manual fallback at 320px; at 390px a test-only, in-browser canvas MediaStream checks UI preview and that explicit stop releases the video track. The stub does **not** validate physical camera access, a browser's real OS grant path, or device drivers. It also tests temporary offline queuing, reconnect submission, HR review, and feature-OFF parity. Screenshots contain **fictional persons only**. The temporary synthetic login handoff file is deleted before any CI artifact upload. Error messages and sanitized evidence JSON are retained for 14 days; screenshots do not contain real PII.

## Evidence interpretation and remaining holds

For **each exact Git commit**, use the dedicated workflow result and its artifacts; a green historical job does not establish that newer source passed. The two SQL jobs, authenticated/browser job, complete ordinary CI, and CodeQL must pass. Distinguish automation from human acceptance:

| Gate | Synthetic development proof | Human / production status |
| --- | --- | --- |
| PostgreSQL 16/18 exact proposal + rollback | Captured by CI; must return PASS | Actual numbered/provenance migration, DBA/clone/restore receipts NOT RUN |
| Two-employer auth, employee/HR separation, replay, audit | Captured by CI; must return PASS | Qualified HR/security witness of operational procedures NOT RUN |
| Four viewport mobile simulation, simulated offline/reconnect | Captured by CI; must return PASS | Physical-device/real-network WFM-14 acceptance NOT RUN |
| On-device consent preview without stored images | Browser simulated track lifecycle and permission-denied fallback; **real grant/device NOT RUN** | Privacy/retention notice, actual informed consent and camera-policy approval NOT RUN |
| Production activation or financial movement | Prohibited | **NO-GO** |

The existing `#691` WFM human 14-scenario matrix cannot be signed by this script. It still requires separate operational testers and physical device proof. The unnumbered proposal remains unapplied until a verified numbered migration with independent catalog/provenance/rollback review exists; green CI does not mean Neon schema was modified. The existing seven-day `localStorage` queue policy and deletion/retention notices require an actual privacy decision before use with real workers. This development-only source work may be integrated with all flags OFF without creating fictional external signatures.

Related: merged #976, #691 WFM operator gates, migration provenance #910, payroll reconciliation #579, protected deployment #112.

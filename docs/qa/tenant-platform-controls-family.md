# Platform controls: five pending exact-method proofs

This separate main-based batch does not duplicate People/platform #1402, HCM
#1404, Performance growth #1406 or Workforce operations #1409. All five methods
remain GAP until real HTTP/PostgreSQL acceptance. Local tests are not credits.

| Method | Exact synthetic operation |
| --- | --- |
| GET enterprise | Read the exact own inactive, unassigned permission-set fixture |
| POST enterprise | Store an own security policy with MFA required and bounded session limits |
| POST developer | Revoke an existing fictional, scope-less API-key record |
| POST automation-studio | Acknowledge an open operational case; do not resolve or retry it |
| PUT organizations | Rename the organization; preserve legal/tax/payroll settings |

The existing shared runner retains two independent attackers, actual higher-ID
victim resources, forged foreign references where supported, discrimination and
unchanged victim target/database/audit snapshots. Each own write checks persisted
employer, row identity, values and an exact actor-bound audit, preserving earlier
audit business records. Only the existing three audit-sealer fields are normalized.

API-key revocation leaves the stored hash, scopes and remaining fields unchanged.
The fixture hash is derived from a fictional non-key marker, not a live credential.
No key is issued, used or returned. Operational acknowledgement preserves worker
and execution state, cannot close the case, and checks the no-source-mutation audit.
Organization rename preserves every other database field and requires an empty
government-fields change list. The security policy requires MFA, leaves SSO optional
and does not contact an identity provider. The read requires the actual own inactive
permission-set row, not an empty response; the set grants no permission to anyone.

No application routes/schema, production SQL, Neon operations, flags, money flags,
mail delivery, provider discovery, external services or tenant/audit guards change.
These are bounded owner-role scenarios, not full identity/SSO/SCIM acceptance or
proof of every branch or role.

Acceptance: inspect exact-head default real HTTP/PostgreSQL logs and all three
profiles; fix failures; add reviewable credits only for successful executed methods;
then require fresh final-head CI. Link-only refresh adds zero credits. Do not merge
automatically.

The first exact-head default HTTP job (121321735156, head `6df9bb00c`) failed
at GET enterprise before write execution: canonical URL generation rejected the
fixture's HTTP APP_BASE_URL under production mode. The fixture now separates
HTTPS canonical metadata (`https://payroll.example.test`) from actual localhost
HTTP probe transport (`SECURITY_SMOKE_URL`). Neither production HTTPS validation
nor origin/MFA/tenant guards are relaxed. A regression exercises the real origin
functions, accepting the loopback same-origin transport while retaining rejection
of foreign/cross-site requests and an HTTP production canonical URL. New real CI
is still required; the failed attempt does not establish the five method credits.

The next default-profile attempt (job 121324069167, head `4d892f618`) passed the
read phase, then exposed a fixture collision with HCM's work-item case. Both used
the same `(organization_id, case_type, source_id)` tuple. The Platform fixture now
uses the valid `coverage_recovery` case type, distinct from HCM's
`attendance_resolution`. A regression invokes both real row factories against the
same employer/worker while enforcing that unique key; a repeated Platform seed
still rejects. Neither the database constraint nor application guards change.

Head `69edc7efc` passed all three real HTTP/PostgreSQL profiles (default job
121328441504, multi-entity 121328441513, flagged-reads 121328441254). The remaining
aggregate check failed on parsing the new environment declaration file; its
constants now use explicit `export declare const`, matching existing declarations.
No lint rules or guards are disabled. Fresh final-head CI is still required;
coverage credits have not yet been generated.

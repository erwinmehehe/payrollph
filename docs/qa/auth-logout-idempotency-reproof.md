# Logout replay source refresh

SOLO_VERIFIED_DEV_RECOVERY; zero new method credits. The existing provisional
POST auth/logout credit is retained at 431 COVERED / 56 GAP / 11 PUBLIC.

[Disposable PG16 HTTP execution](https://github.com/erwinmehehe/payrollph/actions/runs/42432472070/job/128584165166)
passed on `af5cfba882c2461594f5c30b5e44aecfa4f660d4`. The manifest retains
the original merged #1795 provenance and records this #1831 integrity reproof
separately. Every pinned runtime, harness, contract, workflow and schema input
matches that execution. Fresh integration-head CI is still required.

Two fictional attackers each revoke only their presented session. A delayed
replay compares every SQL field, including the original revocation timestamp.
Other devices, the victim's sessions and audit records remain unchanged;
forged selectors are ignored and cross-site requests are refused. The atomic
logout-only helper binds the token hash and requires revokedAt to be NULL.
Shared authentication revocation behavior is unchanged.

No live credentials, production database, provider calls or money flags were
used. Independent security acceptance and production approval remain pending.

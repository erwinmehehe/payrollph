# Earned-wage POST supplemental runtime proof

The guarded `scripts/qa/tenant-earned-wage-post-http.mjs` drives the real POST
handler on disposable PostgreSQL 16 and a loopback production-mode Next server.
It uses two independently authenticated fictional employers, seeded before a
real higher-ID victim. Each own request must persist its returned request ID and
one matching audit. Foreign employers and forged victim worker IDs are denied;
victim requests and full audit rows remain unchanged.

For concurrency, a separate database connection holds the employee row lock.
Both HTTP requests must be observed waiting on database locks before release.
The requests return one 201 and one 422, leaving one pending request and one audit.
The polling clears PostgreSQL's transaction statistics snapshot before each read.

A temporary, uniquely named audit trigger deliberately throws for one fictional
employer's advance event. The HTTP request returns 409 with identical request and
audit snapshots. Removing the trigger allows that same worker's retry to return
201. Cleanup removes the fault-injection trigger and function even on failure.
No application test bypass, production SQL, provider calls, or live flags exist.

Executed locally on the task-owned PG16 cluster at 127.0.0.1:5436 and Next at
127.0.0.1:3016. The JSON receipt pins the tested Git revision. A dedicated CI
workflow repeats the scenario on fresh disposable PG16. Exact-head CI remains
pending until that workflow passes. This is supplemental evidence; POST remains
GAP and no manifest credits or acceptance totals are changed.

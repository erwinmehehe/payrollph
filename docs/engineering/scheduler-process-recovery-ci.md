# Isolated multi-process scheduler lease recovery rehearsal

PR #632's central scheduler lease must be tested across **different OS processes and DB pools**, not only concurrent functions inside a single Node process.

The new `tests/scheduler-process-recovery.test.ts` spawns independent Node 22/tsx contender processes. It verifies: exactly one winner under concurrent starts; the loser cannot acquire before timeout; abrupt SIGKILL leaves a nonexpired lease protecting against duplicate starts; controlled synthetic 16-minute lease expiry allows a new owner; the old owner can no longer renew, release, or write the completion receipt; the new owner can write/finish; and a later fresh owner can acquire a completed lease. This tests actual PostgreSQL lease fencing but does **not** run payroll or other central scheduled jobs.

## Safety boundary

Each subprocess **must** pass `assertIsolatedSchedulerRehearsal()` *before* importing the database. It allows only `CI=true`, `SCHEDULER_REHEARSAL_MODE=isolated-ci-only`, and the fixed ephemeral GitHub Actions PostgreSQL test target `postgresql://postgres:postgres@127.0.0.1:5432/app_db`. All other database names, hosts, ports, users, credentials and query strings fail closed. Do not weaken this allowlist to point at a shared staging or actual employer database.

CI enables the flag only for the `npx tsx --test tests/*.test.ts` step after `db:push` initializes the isolated PostgreSQL 16 service. Test data consists exclusively of random `ci-scheduler-` and `ci-receipt-` scheduler_state rows; there is no tenant, salary, payout, tax, real employee, or provider data. Child IPC reports only booleans; tokens and DSNs are not logged. Tests clean up all child processes and synthetic rows in a `finally` block.

**This is controlled synthetic CI evidence, not the independently witnessed actual staging acceptance** required in #637. It does not test the full `tickScheduler` effects, cross-service network reliability, watchdog alert delivery, salary idempotency, employer payroll certification, or two deployed worker instances. Leave `CENTRAL_SCHEDULER_ENABLED=false` in production until separate operational and independent HR/payroll/security release gates are met.

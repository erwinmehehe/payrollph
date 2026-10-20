# Owner practice payroll

`OWNER_PRACTICE_PAYROLL_ENABLED=true` enables the optional owner dashboard card.
The critical-release registry defaults it off; unset/false does not add a dashboard
JSON field or render a card. Only an authenticated, company-wide owner receives
the fixed fictional payload after normal dashboard employer authorization.
Production configuration is not changed by this PR.

The server calculates three fixed fictional scenarios through the existing payroll
engine: monthly team, mid-cutoff hire and daily attendance. The browser selects
precomputed fictional rows, reconciles integer-cent totals, walks through a
clearly labeled practice review and displays a watermarked sample payslip.
There are no practice write endpoints, persisted records, bank IDs, live worker
IDs, downloads, payments, government submissions or actual approvals. Closing
practice, reloading or switching employer resets the exercise.

This does not satisfy real payroll readiness. A real first payroll still requires
valid employer/worker setup, payout details, required MFA, and a separate checker
where maker-checker applies. Practice review does not approve any real run.
Sample dates/rates/calendars are fixed illustrations, not filing certification.

## Verification

Run with a deliberately unreachable loopback database URL to verify the fixed
calculator requires no database I/O:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:1/unused_practice TZ=Asia/Manila npx tsx --test tests/owner-practice-payroll.test.ts
DATABASE_URL=postgresql://postgres@127.0.0.1:1/unused_practice npx tsx scripts/qa/owner-practice-fixture.ts
node scripts/qa/owner-practice-browser.mjs
```

The component browser workflow produces desktop/390px screenshots and a results
JSON. It exercises the actual component and canonical generated fixtures, keyboard
focus, empty/error/review/reset states, flag-off DOM equality and zero API calls.
It does not claim to replace authenticated HTTP or database verification.
The separate guarded security HTTP harness checks owner/foreign/anonymous
authorization and unchanged worker/run snapshots against disposable PostgreSQL.

Manual checks remaining: screen-reader announcements with a human operator,
live owner discovery after an explicitly approved feature activation, and the
independent real-payroll review journey. Roll back by removing the environment
flag; no data migration or cleanup is needed.

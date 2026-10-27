# Year-End tax reporting — isolated GET JSON tenant evidence

**Draft, zero credits, NOT ACCEPTED.** Method `GET year-end` is still GAP.

This batch tests the **read-only `format=json` variant only**. It intentionally
does not exercise GET alphalist, Form 2316, printable output or preflight;
it does not exercise annualization POST, statutory filing or money movement.

A disposable PostgreSQL 16 instance with three independently authenticated
fictional employers contains populated year-end tax adjustment rows and unique
refund values. Employers A and B must each see their own nonempty 200 JSON
report and receive 403 when requesting the higher-ID victim C's report.
The victim must have a valid own-positive report. The genuine owned HTTP
response from A must fail B's own-data assertion.

All employer annualization rows, payroll, worker and business-audit states
must be identical before and after GET and foreign denials. The dedicated
localhost CI workflow requires production-mode Next on 127.0.0.1:3000, a
fresh disposable PostgreSQL 16 at 127.0.0.1:5432/app_db, workers OFF,
providers and payouts OFF and no production credentials.

No application routes, schema, migrations, global tenant manifest, shared
runner, other PR file or coverage reservation is altered. **No automated
COVERED status or merge.** Require successful exact-head HTTP CI and
independent security review. Other GET variants need separate positive
and negative evidence before the method can receive coverage credit.

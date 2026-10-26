# WFM clock-in watch: bounded lease-loss continuation fix

Tracking: [engineering issue #1435](https://github.com/erwinmehehe/payrollph/issues/1435).

## Confirmed source defect

At main `f9ea6c15a2e0f155a849016f23ab0e3c94489cb3`, both clock-watch
lanes already had keyset paging. The central scheduler checked its lease before
calling temporal automation, but neither watch lane checked it during the scan,
worker loading or advisory dispatch loop. A heartbeat could detect loss while
the old attempt continued starting watch work. The temporal monitor catch could
also hide a lease-related failure as an ordinary unavailable optional monitor.

## Change

Pass the existing central scheduler authority down to the temporal watch and
both implementations. Reconfirm before each assignment page, worker-read batch
(each worker's schedule in the legacy lane), and each advisory event. Lease
probe failure is latched for that attempt and becomes a sanitized typed error;
neither optional-monitor nor per-job failure isolation may swallow it. Recheck
authority before the following reminder lane and temporal completion marker.

This is cooperative cancellation at explicit boundaries. It cannot cancel a SQL
read or event operation already in flight, provide an atomic fence around the
automation engine's independent transaction, or retract an already-started event.
The existing central completion receipt fence, event idempotency and durable
PostgreSQL lease are retained. No new scheduler or replacement paging engine.

## Executed local evidence

- 1,000 fictional workers across two employers with real schedule rows, real
  schedule resolution and actual SQL lease acquisition, expiry and takeover.
- Both legacy-paged and roster-scale lanes complete 1,000 distinct advisory
  intents with exact worker/employer attribution under a valid lease.
- Replacement before page two and before worker loading yields zero dispatches.
- Replacement after the first dispatch permits no subsequent dispatch; the old
  owner cannot refresh or release the replacement lease.
- Delivery alone is stubbed. No automation/outbox/provider operation is sent.
- Pure tests cover missing authority, sanitized errors and the no-revival latch.
- Existing WFM-12 CI mapping includes the new non-skipped PG regression.

Local receipts are in the separate worktree's `outputs/clock-pg-proof.log` and
`outputs/clock-unit.log`; exact final-head checks are recorded in the draft PR.
Fresh GitHub CI remains required. The scheduler's minimal-schema crash-recovery
job remains minimal; the full-schema WFM matrix runs this worker stress case.

All fixtures and lease takeovers are disposable localhost operations. Runtime
scheduler, paging, roster, notification and money activation defaults remain
unchanged. No production SQL, real worker data, provider secrets, agency calls,
payroll calculation or release. This fixes one engineering defect under #678;
it does not close #678 or satisfy #691's human/device operational acceptance.

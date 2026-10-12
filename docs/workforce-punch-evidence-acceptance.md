**Disposable-schema tenant safeguard (2026-10-12):** Added composite employee tenant foreign keys to the Drizzle schema for photo consent, encrypted photo evidence and staged punch submissions. The retention integration test now accepts either the canonical 0120 trigger rejection or the equivalent database FK denial in a db:push-only test database. This avoids treating a missing procedural trigger as a successful cross-tenant insert. Canonical 0120 additionally checks worksite, photo/timecard association and independent review and must still be rehearsed separately. No live Neon SQL applied.

# Enhanced Web Bundy evidence — independent acceptance record

**Status:** UNSIGNED / NOT RELEASED. This document is a runnable acceptance
plan, not proof that a DPO, labour/payroll reviewer, or real-device tester has
signed. `WFM_PUNCH_EVIDENCE_ENABLED` must remain `false` until every
relevant gate below has an independently recorded pass.

## Source-only technical work

The proposed schema is the canonical `drizzle/0120_wfm_punch_evidence.sql`
already present on main. Do not introduce a duplicate SQL prefix. Do not run
Neon/production migrations as part of this PR. The implementation stages
attendance submissions; only a different authorised person can promote them
into `time_punches`. A review approval is not a payroll release or payout.

- Exact final commit SHA: **not recorded until CI completes**.
- CI/CodeQL and regression result links: **pending**.
- Independent AppSec reviewer, date, finding disposition: **pending**.
- DPO/RA 10173 legal basis, notice, consent and processor approval: **pending**.
- HR/payroll reviewer and payroll-impact sign-off: **pending**.
- Physical device + low-bandwidth tester, devices and screenshots: **pending**.
- Isolated PostgreSQL DBA rehearsal and rollback/restore reference: **pending**.
- Production owner activation decision (separate from code merge): **pending**.

## Required witnessed scenarios

| Area | Procedure | Pass condition |
| --- | --- | --- |
| Default-off | Start without optional migration and without feature flag | Existing time clocks work; evidence route hidden; no photo data created |
| Migration | Apply canonical 0120 SQL to *isolated synthetic* PostgreSQL, rehearse rollback and restore | Clean tenant triggers, no unplanned DDL, repeatable fixture cleanup |
| Consent accept | Employee A opts in to current notice version and submits an actual foreground JPEG | A single consent receipt and scanned, EXIF-stripped, encrypted evidence only |
| Consent decline | Employee B declines with photo policy required | No image retained; staged time entry still available to independent reviewer; no automatic pay impact |
| Withdrawal race | Withdraw A's consent while image scanning is delayed | No post-withdrawal non-held ciphertext committed; audit and consent choice consistent |
| Policy race | Disable a worksite photo policy while upload scanning is delayed | No image retained after disabling; note reviewer warning and atomic policy audit |
| Legal hold | Hold one expiring test image; withdraw consent or run purge | Non-held images cryptographically deleted; held image retained only under authorised hold with audit |
| Scanner outage | Return network failure, HTTP error, invalid JSON, and dirty response from scanner | Fail closed before encryption/storage; no auto-approval or payment |
| Image attack | Try oversized JPEG, hidden APP/COM after scan, early EOI, XMP/EXIF, non-JPEG MIME | No personal metadata stored; invalid image rejected |
| 90-day retention | Process >90-day synthetic ciphertext, rerun job and attempt image GET | Purged bytes inaccessible and purge idempotent; held/future data protected; scheduler failures monitored |
| Processor/backup | Review actual provider contract, region, backups and restore/disposal controls | DPO-approved retention/deletion handling, including replicated and restored copies |
| Key rotation | Encrypt with previous key, read during rotation, remove old key under documented plan | Recovery procedure verified without exposing key bytes |
| Role/tenant | Tenant B, out-of-scope manager, employee, and anonymous session try GET/image/review/post for tenant A | Every unauthorized read/write rejected; no cross-entity leakage |
| Maker/checker | Employee submits, same actor attempts review, independent manager approves/rejects with MFA and note | Maker blocked; reviewer decision and immutable audit commit atomically |
| Offline queue | Save without network, reload/reopen browser, reconnect on weak cellular network, retry after lost acknowledgement | Exactly one staged submission, no local photo persistence, no silent payable entry |
| Employee switching | Browser with worker A queue signs into worker B; sync attempts A's item | Worker B cannot replay worker A's queued punch |
| Stable shared device | Two workers submit from same installed browser, then repeat after reloading | HMAC per-tenant warning appears as reviewer-only signal; no cross-tenant linking or automatic penalty |
| Midnight shift | 23:30 clock-in, 02:15 clock-out the next Manila day | Independently reviewed out closes prior-day Web Bundy shift; same timecard, both days' exceptions reconciled |
| Midnight conflict | Previous open shift stale, imported, >18h, or conflicting current-day punch | Fail closed to authorised correction; never create competing timecards |
| Cutoff race | Apply company cutoff concurrently with staged approval | Database order serialized; locked dates never mutated after cutoff |
| Time source | 31-minute skew and offline late sync with reviewer choosing device/server time | Selected timestamp + rationale audited, chosen/shift-start/device dates checked for locks |
| Geofence | Online valid GPS and offline no-GPS with configured worksite | Raw GPS not stored, offline remains unverified; worksite not falsely labelled GPS verified |
| Legacy payroll | Compare employee-by-employee unchanged attendance and statutory goldens | Zero unexplained differences above ₱0.01; no new payroll or payout side effects |
| Manual alternative | Simulate refusal, offline disabled, GPS denied and old browser | Employer's documented non-photo HR attendance correction path works |

## Sign-off and go/no-go

For every row, retain tester role, synthetic tenant ID, device/browser version,
timestamp, expected and observed outcomes, ticket/run URL, screenshots or redacted
logs, and PASS/FAIL. Failed or unexecuted rows are **not** pass. Any employee
photo or identifying location used during UAT requires separately approved
test-data handling; prefer synthetic data.

Do not claim NPC/DPA compliance merely because consent or encryption code exists.
A named qualified Philippine privacy/DPO reviewer must confirm lawful basis,
notice wording, data-subject rights, role-based access, retention, local queue
disclosure, legal holds and processor/deletion agreements.

A named Philippine payroll/HR reviewer must sign the overnight, approval,
manual-correction, cutoff, timecard/reconciliation and employee-pay outcomes.
Confirm that pending submissions are not payable; no payroll funds may move in
this acceptance process.

After all gates pass, release owners may separately authorize ordered migration,
environment secrets, scheduler monitoring, worksite policy enablement and a
limited pilot. Merge/source approval by itself is **not** permission to enable
selfie attendance or transmit payout instructions.

## Retention safety correction (source-only)

Purge is no longer conditional on the selfie collection flag: when the optional evidence table is present, the fenced central scheduler checks due encrypted records even if `WFM_PUNCH_EVIDENCE_ENABLED=false`. Without the table and with collection disabled, existing databases continue unaffected. When collection is enabled but the table is missing, the scheduled job fails closed. Bounded 250-photo batches are repeatedly drained; an exhausted limit fails the job instead of falsely acknowledging retention completion. The run records how many encrypted photos were purged, without employee identifiers.

**Operational gate remains:** The central scheduler and its external trigger/health monitoring must actually be deployed and running. Disabling the central scheduler is not a retention plan; require a separately authorized manual/alternate purge path and alerting if paused. Verify backup copy deletion/restore expiry, authorized legal holds, a large backlog, and key rotation with the DPO. No production table, schedule, provider or selfie feature is enabled by this code patch.

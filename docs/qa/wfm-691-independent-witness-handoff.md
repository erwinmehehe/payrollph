# WFM #691 — independent-witness packet (development only)

**P0 evidence-integrity update (October 14, 2026):** The witness `template` intentionally leaves `deployedSha`, `payoutsDisabled`, and `agencySubmissionDisabled` as `null` — nothing has yet been witnessed. Before recording observed PASS rows, a real facilitator must verify the running app SHA and the effective no-payout/no-agency configuration independently, then enter the observed values in the private JSON. A value of `true` is only a self-reported configuration observation; this offline checker never verifies credentials, flags, individuals or the deployment itself. A packet with all 14 PASS rows but any unverified deployment/flag field remains **INCOMPLETE_NOT_ACCEPTED**. No bank/provider or agency action is permitted.

This is an OFFLINE evidence recorder, not a substitute for conducting the WFM-01..14 tests. The existing owner self-UAT recorder documents only self-reported owner checks; this separate packet supports the independent HR, operations, payroll, security, SRE, UX and device reviewers required by issue #691.

## Safety and truth boundaries

- No database, API, payment provider, or agency endpoint is contacted by this tool.
- WFM-01..13 must be exercised by genuine human testers in the actual browser/app against fictional development data. Physical device WFM-14 requires a named supported device and actual observed replay/drift/security testing. Neither can be simulated into approval.
- The input packet may contain actual expected/observed descriptions, so it must be kept in an approved PRIVATE encrypted directory, never committed or attached to public GitHub issues. Reviewer names and identity mappings must remain separately in private evidence.
- Public summaries use opaque UAT-, REV-, BUG-, and DEVICE- references and counts only. This tool does not authenticate witnesses or independently verify signatures; even 14 recorded PASS entries yield RECORDED_PENDING_HUMAN_VALIDATION, never PILOT-ACCEPTED.
- Keep PayMongo/Xendit funds movement and government submissions OFF. Shared Neon default is not a disposable database; use isolated PostgreSQL for destructive fixtures.

## Procedure

1. Verify the exact Git source SHA, actual deployed SHA, fictional tenant/worksite/worker fixtures, roles, provider flags, Manila work dates, and browsers/devices. Do not fill in the deployed SHA from Git until independently verified on the running app.
2. Create the initially empty private packet:

~~~sh
SHA="$(git rev-parse HEAD)"
mkdir -p /absolute/private/691
node scripts/qa/wfm-independent-witness.mjs template "$SHA" > /absolute/private/691/witness.json
~~~

3. Set both exact SHA fields only after comparing the served deployment with the checkout. Have real reviewers carry out the canonical WFM matrix and enter each actual expected/observed outcome, UTC observation time, discipline, opaque reviewer ID and private evidence reference in the file.
4. The default for all fourteen cases is NOT_RUN. A PASS requires expected vs actual observations and a private UAT- reference. A failing observation requires NEEDS_FIX and BUG- reference. Missing equipment/reviewer/etc uses BLOCKED plus a supported blocker code.
5. WFM-04, WFM-07, WFM-08 and WFM-09 require distinct maker/checker opaque references. WFM-14 PASS requires a real physical-device witness declaration and DEVICE- reference; this self-declaration is NOT verified hardware certification.
6. Check structure without exposing private content:

~~~sh
node scripts/qa/wfm-independent-witness.mjs verify /absolute/private/691/witness.json > /absolute/private/691/summary.json
~~~

7. Have actual distinct HR, security, payroll, operations, UX and device reviewers inspect original private evidence and sign or reject against the exact deployment SHA. Retain identities and decisions privately. File a sanitized #691 update only after this human step. Do not mark a missing scenario or device as passed.

## Observed WFM order

- WFM-01/02: Security: tenant A/B isolation, delayed responses, restricted API/export denial.
- WFM-03/04/05: Operations and HR: seven-day multi-site roster (50–200 fictional people), concurrent shifts, leave/qualification and approval integrity.
- WFM-06/07/08/09: Payroll and security: incomplete/duplicate punches, night/rest/holiday/OT to centavo, corrections stale approved timecards, maker/checker separation and payroll cutoff lock.
- WFM-10/11/12: SRE and UX: providers default OFF, failed/retried notifications, network/tenant refresh, 200+ roster/watch paging and leased scanner tick in isolated database.
- WFM-13: UX/employee: real 375px/390px browser, focus, readable errors, correction flow.
- WFM-14: Device/security: actual supported biometric/offline device; drift, disconnected replay, collisions and cross-midnight corrections.

Existing WFM synthetic matrix results are developer-level coverage, not independent human UAT. The real-employer no-money period in issue #579 is a separate payroll/consent/privacy milestone and cannot be inferred from fictional WFM records.

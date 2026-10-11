# Controlled workforce GPS self-clock pilot (source feature)

**No production activation authorization.** The feature is default-OFF. No continuous tracking, no identity proof, and no biometric certification. Source changes need exact-head CI and staged employer acceptance. GPS can be spoofed, blocked, stale or inaccurate indoors.

## Configuration and migration order

1. DBA reviews and rehearses `drizzle/0111_wfm_geofenced_web_bundy.sql` against a disposable PG16 tenant. The migration creates a **separate pilot-only table**; no pre-existing worksite column changes. Default-off application deployments do not query that table. Apply and verify the optional table on staging before enabling any pilot employer. Rehearse rollback and inspect all upstream worksite dependencies. No live database was modified by this branch.
2. Create or verify a specific, active employer worksite and an effective-dated primary employee assignment or explicit HCM secondary authorization. Existing HCM worksite denial always wins.
3. After the DPO approves employer legal basis, purpose notice, access scope, privacy retention and a written exception process, set `WFM_GEOFENCE_PILOT_ENABLED=true` **and** `WFM_GEOFENCE_PILOT_ORG_IDS` to a comma-delimited allowlist of actual staging employer IDs. Both required. Never set a blanket all-organizations flag.
4. A company-wide workforce administrator with recent MFA configures the site GPS centre and radius 100-2000m in Workforce > Worksites, recording a reason. Audit records the site ID/radius/reason and configured state; they do not store employee GPS coordinates.
5. Employee signs in to their own account via HTTPS on mobile browser and chooses Clock IN or Clock OUT. Only then does the browser request a new high-accuracy GPS fix. Server validates freshness (60 seconds), accuracy (100 metres), authorized active worksite and distance. Denied fixes do not create payroll hours. The server logs coarse distance/accuracy bands and site ID, not raw GPS fixes; coordinate fields are discarded from the request.
6. HR must provide a fair reviewed alternative for employees without reliable GPS/permission or with an erroneous boundary (workforce absence/attendance exception procedure). Validate local labor rules; absence of a GPS result is not evidence of absence or non-work.
7. Disable by unsetting the rollout environment values; worksite configuration can also be disabled, which **blocks** site-specific GPS capture rather than silently bypassing enforcement.

## Witnessed staging acceptance

- Authorized on-site employee, accurate fresh GPS -> one correct punch and one scoped audit event, no raw GPS in DB/audit/export.
- Out-of-boundary, stale, missing, inaccurate, future-dated, malformed fix -> HTTP 422 and no attendance mutation.
- Disabled employer works exactly like existing Web Bundy; managers can still record team time with original RBAC.
- Enabled employer manager on behalf -> HTTP 403, cannot bypass self-clock.
- Active primary site, approved secondary site, denied primary/secondary, expired assignment and different-employer worksite -> authorization matches effective date and tenant.
- Locked payroll cutoff -> HTTP 423; no geofence override. Repeat punch -> existing duplicate control.
- Two parallel requests, shared kiosk, missed/overnight punches, stale timesheet propagation, pay-run calculations -> existing payroll safeguards and reviewed corrections still work.
- Mobile Safari and Chrome over HTTPS, foreground permission opt-out, poor indoor accuracy and assistive technology accessibility review.
- Review operational telemetry, operator rollback, tenant isolation, data protection agreement, employment privacy notice and labor counsel sign-off before activating any real workforce.

**Do not call this certified GPS identity verification or production-ready.** Site boundaries are employer policy controls; GPS can be forged and cannot conclusively show an employee worked. No physical device attestation is included.

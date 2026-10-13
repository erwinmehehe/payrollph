# WFM five-worker development acceptance — synthetic, no money

**Status: engineering test candidate. Do not mark as passed until the exact PR-head GitHub Actions job succeeds.** This is not independent WFM-01–14 UAT, Philippine bookkeeper certification, real payroll reconciliation, an external employer pilot, or production release authorization.

## Objective

Exercise five fictional workers in one disposable Philippine tenant, plus one separate fictional tenant-B isolation sentinel, through a connected roster → attendance evidence → correction/OT approval → independently reviewed timesheets → calculated payroll preview. Nothing is released and no payout/agency/provider endpoint is invoked.

| Test worker | Work scenario | Expected worked minutes in the synthetic historical payroll cutoff |
| --- | --- | ---: |
| A1 | 09:00–18:00 with a 60-minute break | 480 |
| A2 | 22:00–06:00 next day, 02:00–03:00 break; 420 night minutes over two PH dates | 420 |
| A3 | 09:00–19:00, 60-minute break and 60-minute manager-approved overtime | 540 |
| A4 | Incomplete clock-out, employee correction requested, separate manager decides | 480 after correction |
| A5 | Ordinary shift plus 09:00–18:00 work on a resolved rest day | 960 |
| **Total** | **Five fictional workers; six historic synthetic punch records** | **2,880 (48 hours)** |

The historical September payroll punches are deliberately seeded on the ephemeral PostgreSQL instance so the actual period and premium boundaries can be tested. The harness separately calls the authenticated **current-day** employee Web Bundy clock-in/out endpoint (including duplicate clock-in and worker-identity denial), and it explicitly does **not** claim those live API punches produced the historical payroll. This limitation is material; a real-device past-dated punch cannot be simulated by relabeling a seeded record.

## Guardrails

- GitHub-hosted CI only, exact loopback application host and disposable 127.0.0.1:5432/app_db; abort if any organization already exists.
- Fresh fictional workspace and users, without real employer records, photos, biometrics or bank information.
- PayMongo, Xendit, WFM photo evidence, GPS/geofence and external AI disabled; no release/payment or agency submissions.
- Test source does not modify a production schema, deploy a new service, enable feature flags or touch shared Neon.
- Test passwords and bank encryption keys are isolated CI fixtures. Privileged MFA is disabled **only within this throwaway CI acceptance process**; production MFA enforcement is a separate mandatory gate.

## Server-level checks

1. Bootstrap owner, five workers and two distinct reviewer identities. Read authenticated seven-day roster, verify count and authoritative IDs; deny tenant A↔B crossover.
2. Establish approved shifts and schedules. Insert six explicitly seeded fictional historical punches, including overnight, overtime, incomplete, and rest-day work.
3. Confirm incomplete punch has zero payable minutes and a blocker. Require employee correction plus a separate manager decision. Deny employee self-decision, and refuse premature cutoff while correction is pending.
4. Approve one hour of actual overtime using a different actor from its requester. Confirm all five corrected/authorized timesheet snapshots have exactly the expected worked minutes and zero blockers.
5. Set timesheet enforcement to block; verify payroll processing rejects missing approvals. Submit five timesheets and approve with **two independent synthetic reviewer accounts** (manager for A1–A3; HR for A4–A5). Verify attempted manager self-approval of A5 is denied.
6. Enable required cutoff lock. Verify payroll processing rejects missing lock; lock the period and deny employee unlock.
7. Calculate the preview using existing authenticated payroll-run endpoint and inspect five separate entries: 2,880 total segmented minutes, 420 night minutes on A2, 60 overtime minutes on A3, and 480 rest-day minutes on A5. Reject missing source trace or unverified premium allocation. Verify tenant B cannot read A's register, the record is not Released, and the release checklist is not ready.
8. Separately verify current-day Web Bundy IN/OUT worker binding and duplicate-in failure; never suggest the live event is a payroll-period punch.

## Evidence and next sign-off

The dedicated workflow is **WFM Five-Worker Development Acceptance (No Money)** and writes qa-artifacts/wfm-five-worker-dev-report.json. It contains fictional scenario codes, expected/observed minutes, a small check list, the source SHA, and explicit NOT_RUN markers for independent UAT/real device/real employer/payroll-release evidence. No real personal data or wage values should enter this report.

A successful job means **synthetic development coverage only**. Actual manual manager, HR, Philippine bookkeeper, mobile and security review under issue #691 still requires a qualified real reviewer, observed expected/actual results and privately retained evidence. Payroll release, shadow-payroll comparison and production flags remain blocked under their separate gates.

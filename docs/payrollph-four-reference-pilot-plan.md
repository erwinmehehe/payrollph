# PayrollPH narrow reference work: first payroll, field attendance, filings and public trust

Status: source changes under review, not production approval. Reference products: Gusto (guided onboarding), PayrollHero (field capture), JuanTax/Sprout (PH filing operations), Vanta/Rippling (trust evidence). Product names are comparative references only.

## First payroll (U-4)

The canonical workspace overview now uses one seven-stage journey derived from existing five-item `FirstPayrollReadiness`. The duplicate self-serve quickstart is no longer shown alongside the readiness card. Steps route to current employer settings, people, attendance, payroll, approvals and exports. No new payroll mutation, new role permission, billing waiver or certification is introduced. Attendance remains a human review step; an export remains receipt-pending even after payroll release. Record a screen-reviewed, two-role 375px mobile and employer switch pilot before closing U-4.

## Geofenced self-clock (planned, not enabled)

Build on `/api/web-bundy`, existing worksite authorization and Manila work date, not a second attendance ledger. Introduce employer opt-in feature flag and published field-work policy before enabling location capture.

- Require a self-clocked employee with server-side employer membership, not a manager clocking on behalf of another employee; do not quietly collect location from shared tablets.
- Resolve assigned and expressly authorized worksite for the clock date on the server. Store per-worksite permitted coordinates and radius in a DBA-reviewed migration, plus an administrative audit trail.
- Request browser position only after the employee deliberately presses a clock action, over HTTPS. Validate finite latitude/longitude, allowed ranges, accuracy, maximum fix age and the nearest approved site on the server; never trust `location` free text as GPS proof.
- For enforcement, **fail closed when permission is denied, coordinates are stale, precision is inadequate or no eligible site exists**. Provide a manager-reviewed location exception flow with a reason so employees are not silently unpaid. Do not automatically treat GPS as proof of identity or spoof resistance.
- Retain only worksite ID, rounded distance band, result, accuracy band and policy version for audit, not raw continuous GPS tracks or EXIF. Define short evidence retention, access scoping, purpose notice, HR legal basis and DPO review before staging collection.
- Do not switch existing browser clock or biometric-device paths to GPS enforcement until compatibility tests and employer acceptance. Biometric certification remains separately pending.
- Negative tests: cross-tenant, unauthorized worksite, missing GPS, stale fix, simulated inaccurate GPS, tampered client worksite ID, shared kiosk, payroll cutoff lock, replay and concurrent punches.

## Philippine filings (existing system; external acceptance open)

Existing draft generators: 1601-C worksheet, SSS R-3 worksheet, PhilHealth RF-1 worksheet and Pag-IBIG MCRF worksheet. Existing evidence model correctly distinguishes operational portal acknowledgement from file-format acceptance and version/hashes. Do not falsely label any worksheet agency-upload-ready. BIR 2316 is an annual employee certificate, not interchangeable with monthly 1601-C. BIR annual Alphalist source extract is not the official ADES-produced DAT.

For each employer/agency, reconcile official filing period and totals to a final-cutoff payroll source, capture generator version + exact file hash, have an operator use the current official portal workflow and retain an **agency acknowledgement or rejection**. Record the actual submission method (manual portal entry versus file upload). Mark format accepted only when that precise generated version was successfully uploaded; portal manual entry proves an operational filing at most. Do not claim receipt or certification based on a local preflight. Recheck current official agency templates at time of employer pilot.

## Public trust (S-9)

Public `/trust` is an evidence guide, not a certification, independent uptime monitor or readiness diagnostics leak. `/api/status` is public aggregate status sample data; `/api/readiness/pilot-status` remains token-protected, fail-closed with no-store. Never move secret fingerprints, tenant totals, private audit evidence or production readiness gates into public marketing. No SOC 2/ISO certification, security audit attestation or uptime SLA is claimed without proof.

## Release

Risk T1 for content/journey navigation; future geofence API and stored evidence would be T2/T3 (privacy and financial capture). Run exact-head typecheck, lint/warning baseline, full suite, four golden payroll suites, production build and browser checks; obtain employer privacy review and government receipts independently. Rollback for the navigation/trust slice: revert its source commit. No live payroll, filing or location data was accessed.

# First-payroll mobile acceptance

Issue #744 U-4 requires a witnessed two-role phone walkthrough and employer switching. The HRIS Integrated Journey Browser QA workflow now adds an automated 375x812 Chromium check after the desktop HRIS scenarios. It uses only a disposable localhost database and fictional identities.

The owner and payroll officer each verify seven ordered guide steps, the People handoff, no duplicate legacy tiles, readable card bounds and no calculation/release action while payout setup is incomplete. The owner uses the actual employer menu to switch from a fictional self-serve employer to a legacy pilot and back, verifying guide mode and roster counts refresh. The payroll officer's direct request for the unassigned second employer must return 403.

The fixture inserts fictional subscription state directly into the disposable database. It does not test payment collection, sign-up email delivery, or a billing provider. No payroll run is created, approved or released by this test. Chromium viewport emulation is not physical-device acceptance.

The initial browser run exposed an unrelated People Operations Inbox response-contract bug: the authorized API omitted `organizationId`, so its client refused to render the data. The route now returns the already authorized employer ID alongside its paginated payload. The owner browser check verifies that response binding; tenant and role checks remain authoritative.

The companion Production Pilot Payroll QA now exercises source onboarding completion for the same fictional workers and prepares/downloads four draft government worksheets after payroll record release. It checks file hashes, repeat-generation identity and employee-role denial, leaving every filing record in `generated` status. The WFM 14-scenario workflow is triggered alongside the mobile and payroll scripts. Its thirteen automated groups do not complete the fourteen independent UAT scenarios.

The payroll harness uses employee-record creation and seeded historical punches. It does not prove recruitment candidate conversion, physical clock capture or an operator completing the whole nine-stage journey without help. Keep those gaps explicit until a protected staging operator run supplies evidence.

The extended September-cutoff/October-pay-date run exposed a filing metadata mismatch: BIR 1601-C generated an October worksheet, while its recording path expected September. The recording path now uses the pay month already selected by the generator for 1601-C. Contribution worksheets continue using the cutoff month. The HTTP journey asserts both month bindings and exact downloaded hashes; it never records agency acceptance.

## Evidence and next operator test

The workflow retains `first-payroll-mobile-synthetic.json`, with the source SHA, passed checkpoints and explicit false values for independent operator, physical device, real employer and production acceptance. A failed assertion retains a fictional-data screenshot. A missing artifact is not a pass.

After an authorized isolated staging build is available, have actual owner/payroll operators complete the whole company → people → time → reviewers → calculation → independent approval → exports journey on a physical phone. Capture expected/actual results, exact deployed SHA, role, employer switch, keyboard/focus and network recovery privately. Record incomplete stages and defects rather than inventing review or release evidence.

Production configuration/migration evidence remains in #112 and #744; full WFM human execution remains in #691; real no-money payroll reconciliation remains in #579; agency import/acknowledgement proof remains in `docs/ph-official-filing-acceptance-pilot.md`. These gates remain open until their own authentic evidence exists. Deeper forecasting/HCM feature work stays behind the pilot gates in the remediation register.

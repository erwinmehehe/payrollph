# Manual-ops launch playbook

This is for launching Linaw to a small batch of pilot SMEs before the four
automated integrations (email, billing, bank submission, government filing)
are wired to live providers. Check current status any time at `GET /api/readiness`
The `manualLaunch` field tells you honestly whether you're clear to do this.

## 0. Clear the critical production gates first

Before any pilot customer payroll, production must have the non-negotiable
security and data-protection gates green:

1. Set `APP_BASE_URL` to the canonical HTTPS production origin.
2. Configure a valid 32-byte `TOTP_ENCRYPTION_KEY`.
3. Keep `DEMO_MODE=false` and rotate any public review credential.
4. Configure bank-data encryption using either a dedicated
   `BANK_DATA_ENCRYPTION_KEY` or the production TOTP master. Then run the
   **Production Bank Encryption** GitHub Actions workflow in `dry-run` mode,
   followed by `apply` only after the key fingerprint matches live production.
   Re-run the dry scan and confirm there are zero plaintext employee bank
   accounts and zero plaintext payroll payment snapshots.
5. Configure `PII_ENCRYPTION_KEY` (or the approved domain-separated fallback),
   run `npx tsx scripts/encrypt-government-ids.ts` as a dry run, then rerun it
   with `--apply`. Confirm the `government-id-encryption` readiness gate shows
   zero plaintext employee government identifiers and contractor TINs.
6. Keep document uploads disabled unless the malware scanner is configured and
   verified.

The production rollout workflow treats these as critical. Do not bypass them
with manual process notes.

## 1. Email: get this wired first, don't work around it

Unlike the other three, there's no acceptable manual substitute: password
resets and invitations carry a token that should never pass through a human.
This is also the cheapest fix on the list.

1. Sign up at https://resend.com (free tier covers a pilot's volume).
2. Verify a sending domain (or use their sandbox domain for the first few users).
3. Create an API key and a webhook signing secret.
4. Set `MAIL_FROM`, `RESEND_API_KEY`, and `RESEND_WEBHOOK_SECRET` in the
   production environment, then redeploy.
5. In Resend, point the webhook at `/api/webhooks/resend` on the production
   origin and enable delivery events.
6. Send a real invitation or password-reset email to an address you control.
7. Confirm the provider reports the message as delivered and Linaw records the
   delivered webhook event. A provider accepting the send is not enough.
8. Confirm: `GET /api/readiness` → the `email-delivery` gate flips to
   `ready: true` only after at least one provider-confirmed delivery exists.

## 2. Billing: manual invoicing

For pilot SMEs, invoice them yourself (GCash, bank transfer, whatever you'd
normally use) instead of routing through PayMongo/Maya.

1. Confirm the payment yourself (check your GCash/bank inbox).
2. Run:
   ```
   npx tsx scripts/manual-activate-subscription.ts \
     --org <organizationId> --plan Core --cycle monthly \
     --amount 1500 --note "GCash transfer ref 123456, confirmed 2026-09-23"
   ```
3. This writes a `paid` invoice and an `active` subscription with
   `provider: "manual"`, and logs an audit event. `getEntitlements()` treats
   this identically to a PayMongo-paid org. There is no separate code path
   to keep in sync.
4. Re-invoice each period by running the script again before the current
   `periodEnd`: there's no auto-renewal without a real payment provider, so
   put a reminder on your own calendar.

This is deliberately a script you run yourself, not an in-app button: there's
no platform-operator role in this codebase (only per-organization roles), so
exposing this as an HTTP endpoint would mean either building a new privilege
tier or trusting a client-supplied flag, both wrong to ship quickly. Anyone
who can run this script already has full database access.

## 3. Bank disbursement: use a bank-issued layout or PayMongo

**Manual corporate-bank upload is supported, but the upload file must come from
the bank's own onboarding/template contract. Linaw must not guess it.**

1. Release payroll and use a dry-run bank worksheet to reconcile employee
   destinations and net amounts.
2. Obtain the current payroll-upload layout, converter, or template from the
   company's enrolled bank channel.
   - Metrobank MBOS: download the payroll sample inside MBOS. The bank's
     published guide says the template is fixed and the accepted upload format
     is Excel 97-2003 (`.xls`), so a Linaw CSV is not a substitute.
   - Security Bank DigiBanker: use the bank's Payroll Manager/Payroll Converter
     materials supplied for the enrolled account.
   - BPI BizLink, BDO, RCBC, UnionBank, China Bank, EastWest and other corporate
     channels: use the layout or converter supplied during bank onboarding.
3. Configure that exact delimited layout in `bank_templates.mappings` when
   Linaw's mapping engine can represent it. If the bank uses fixed-width bytes,
   Excel, XML or another proprietary format, keep using the bank-issued file
   until Linaw has a dedicated renderer for that format.
4. Generate a bank-validation record for a released payroll, upload the exact
   hashed file to the corporate portal, and record the portal's acceptance
   reference under `/api/compliance/bank-validations`.
5. Only the same bank-template name/version that has recorded acceptance may be
   used for a manual payout-completion record. Any template change requires new
   UAT evidence.

**PayMongo Disbursements is the alternative automated path** when the employer's
PayMongo account and wallet are eligible. Use the existing preflight to verify
credentials, receiving-institution mappings and wallet funding without moving
money, then enable live disbursement only after that preflight and signed
transfer-webhook handling are green.

## 4. Government filing: official manual workflows are launch-safe; direct-file automation needs UAT

Linaw's current SSS, BIR, PhilHealth and Pag-IBIG exports are reconciliation or
source artifacts. They are useful for checking figures, but they are **not**
represented as agency-upload files. A successful filing made through an agency
portal/generator is recorded as `manual_entry` until Linaw produces the exact
current agency file and that exact file is accepted.

1. **BIR 1604-C / Alphalist and Form 2316**
   - Run Linaw year-end annualization and settle any December refund/collection
     through the final payroll.
   - Use the current BIR Alphalist Data Entry and Validation Module. The current
     BIR release is version 7.4, and taxpayers using their own extract programs
     must follow the current 1604-C file structure and naming rules.
   - Encode/convert the Linaw annual source figures in the BIR module, validate
     the generated DAT, submit through the applicable BIR electronic filing
     route, and retain the validator/submission acknowledgement.
   - Linaw's current CSV is not the DAT. Do not record it as `file_upload`.

2. **SSS R-3 / Contribution Collection List**
   - Reconcile the final monthly SSS/MPF/EC figures from Linaw.
   - In My.SSS, create/maintain the Contribution Collection List, or use the
     current official SSS R3 File Generator if that is the employer's workflow.
   - Generate the PRN, pay through an SSS-accredited channel, and retain the PRN
     and acknowledgement.
   - Linaw's R-3 CSV is a worksheet, not an official generator output.

3. **PhilHealth RF-1 / EPRS**
   - Reconcile the monthly PhilHealth salary base and employee/employer shares
     in Linaw.
   - Use EPRS as the authoritative employer reporting and payment workflow.
     PhilHealth has documented softcopy RF-1 upload facilities, but Linaw does
     not claim current template compatibility without a current EPRS-issued
     file contract and portal acceptance.
   - Retain the EPRS/ePAR acknowledgement and payment evidence.

4. **Pag-IBIG MCRF / eSRS**
   - Linaw now mirrors the published MCRF member-level source fields:
     MID/RTN, account number, membership program, member name, `YYYYMM` period,
     employee share, employer share and remarks.
   - Pag-IBIG's published MCRF instructions prescribe an Excel workbook and an
     employer-ID + `YYYYMM.xls` filename. Linaw's CSV is source data for
     reconciliation/copying, not that workbook.
   - Use Virtual Pag-IBIG eSRS to maintain the employee list and create the
     Payment Instruction/PIN, or use the current prescribed MCRF workbook and
     accredited payment channel required by the employer's setup.
   - Retain the Pag-IBIG payment instruction and posting/payment evidence.

5. **Evidence rules**
   - Create filing evidence under `/api/compliance/filing-validations` for the
     relevant period and record the agency reference after filing.
   - For the current Linaw reconciliation/source artifacts, use
     `submissionMethod: "manual_entry"`. The API rejects a false
     `file_upload` acceptance for an artifact that is not designed for direct
     agency upload.
   - Direct-file format readiness stays red until Linaw has a real
     agency-compatible generator and the exact generated bytes are accepted.
     This is a scale/automation gate, not a reason to bypass the official manual
     filing workflow for a controlled launch.

## When to stop doing this manually

- **Billing**: once you have more than a handful of customers, or once
  renewals become hard to track by hand. Wire PayMongo/Maya.
- **Bank**: once payroll volume or headcount makes manual upload a real time
  cost. Wire `BANK_HOST_TO_HOST_URL`.
- **Government filing**: automate each agency only when the current official
  file contract is implemented and the exact generated file has passed agency
  validation/UAT. Until then, keep the official portal/generator handoff explicit
  and retain acknowledgements as compliance evidence.

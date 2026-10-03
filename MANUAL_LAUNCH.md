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

## 3. Bank disbursement: manual upload, or PayMongo Disbursements

**Manual upload (no setup required):**
1. Run payroll and release it as usual. Bank files (BDO DAT, BPI/UnionBank
   CSV, GCash disbursement CSV) generate and dry-run validate automatically.
2. Download the file from the payroll run's export screen.
3. Log into online banking / GCash for Business yourself and upload it
   through their normal bulk-disbursement flow.
4. Tell the bookkeeper this step is manual for now. It's a normal workflow
   for small PH payroll operations, not a degraded one.

**Or: automate it with PayMongo Disbursements**, no per-bank negotiation
required, using the same PayMongo account already wired for billing:
1. In the PayMongo Dashboard, confirm your Business Type is "Registered"
   (Sole Prop, Partnership, OPC, or Corporation), an Individual/Unregistered
   account cannot send to external banks. Upgrade if needed under Payment
   Methods.
2. Confirm the Wallet is "Enabled" (not Closed-loop) under Money Movement →
   Wallets, and fund it. A disbursement debits the wallet balance directly.
3. Set `PAYMONGO_DISBURSEMENTS_ENABLED=true` and `PAYMONGO_WALLET_ID` (the wallet
   id from Money Movement → Wallets) alongside your existing
   `PAYMONGO_SECRET_KEY`. PayMongo requires a source account on every transfer;
   Linaw reads it from that wallet. The preflight and the submit both read the
   available balance and stop with the exact shortfall if the wallet cannot
   cover the run.
4. `POST /api/payroll-runs/<id>/exports` (an owner/admin/bookkeeper session)
   submits the run as one PayMongo batch transfer. PESONet by default for
   real payroll batches, InstaPay only for a single small correction payout.
   See `src/lib/paymongo-disbursements.ts` for the implementation; it
   resolves each employee's bank to PayMongo's live receiving-institution
   list rather than a hardcoded BIC table, since a wrong bank code would
   misroute real money.
5. Confirm: `GET /api/readiness` → the `bank-validation` gate should flip to
   `ready: true`.

## 4. Government filing: no accreditation needed for file-based filing, but validate before you flip the flag

I initially framed this as needing formal BIR "Tax Software Provider" accreditation. That's wrong for standard SME filing. BIR publishes the Alphalist `.DAT` layout and gives away the **ADES** (Alphalist Data Entry and Validation) desktop tool for free; no vendor certification required. SSS does the same with a free **R3 File Generator**. Accreditation is a separate, heavier program mainly relevant to large taxpayers doing real-time e-filing integration, not something a manual-ops pilot needs.

What our DRAFT exports are *not yet*: an exact byte-for-byte match to BIR's ADES-importable `.DAT` layout. That layout wants separate last/first/**middle** name columns and precise TIN/branch-code fields. The employee model now carries separate first/middle/last name and TIN/branch fields, but guessing the remaining byte-level ADES contract from memory is still exactly the kind of thing not to fabricate. So the DRAFT stays a correct-figures CSV, not a claimed-compliant `.DAT` file.

What I did fix without needing the full spec: the TIN is now split into the documented 9-digit TIN + branch-code convention (was previously dumped as one hyphenated string).

1. Generate the DRAFT worksheets as usual (2316/Alphalist, SSS R-3, PhilHealth RF-1, Pag-IBIG MCRF).
2. Enter the figures by hand into BIR's free ADES tool / SSS's free R3 File Generator / PhilHealth's and Pag-IBIG's own portals.
3. Confirm each one is accepted/validates clean.
   - **BIR & SSS**: match a published file layout, validated by BIR's free ADES tool / SSS's free R3 File Generator.
   - **PhilHealth**: also has a file-based path, an "RF-1 Excel Format" template PhilHealth provides, saved as a delimited textfile and submitted via EPRS or a bank upload facility, but we haven't built a generator for it since the exact column layout isn't confirmed yet. Enter the DRAFT figures into EPRS directly for now.
   - **Pag-IBIG**: I could not confirm a published batch-file spec for MCRF the way BIR/SSS/PhilHealth have one. Other PH payroll tools seem to only produce a filled PDF for this one. Pag-IBIG does run **eSRS** (Electronic Submission of Remittance Schedule) for online submission, but it is open only to employers with **at most 30 employees**, and whether it takes a bulk file or requires manual encoding is still unconfirmed: their site sits behind a CAPTCHA, so this needs a human to check. Treat it as portal data entry (eSRS if you are under the headcount cap, otherwise Virtual Pag-IBIG employer e-services) until confirmed otherwise directly with Pag-IBIG.
4. **All four filings (SSS R-3, BIR Alphalist, PhilHealth RF-1, Pag-IBIG MCRF) have an evidence trail instead of an honor-system flag.** Record results on the Exports page (one card per form), or through the API: `POST /api/compliance/filing-validations` with `{organizationId, runId, agency, form}` creates a record for the exact file (identified by its SHA-256). Download that file from `GET /api/compliance/filing-validations/<id>/file?organizationId=<org>`, use it with the agency, then `PATCH /api/compliance/filing-validations/<id>` with `{organizationId, outcome: "accepted", submissionMethod: "file_upload", agencyReference, submittedAt}` (or `outcome: "rejected"` with a `note`). Only an accepted use of the generated file counts toward the gate; re-typing the figures (`manual_entry`) is recorded but does not count, because it does not show the file works. The old `SSS_R3_VALIDATED`, `BIR_ALPHALIST_VALIDATED`, `PHILHEALTH_RF1_VALIDATED` and `PAGIBIG_MCRF_VALIDATED` flags are no longer read.
   - **SSS R-3** (`agency: "SSS", form: "R-3"`): upload the file in My.SSS and record the PRN or acknowledgement number.
   - **BIR Alphalist** (`agency: "BIR", form: "1604-C"`): load Linaw's annual source extract into BIR's ADES, which produces the `.DAT` you email to esubmission@bir.gov.ph, then record the validation report or "ticket" reference BIR sends back. Two limits to know: Linaw builds this extract from one payroll run, not the whole tax year, so an acceptance shows the layout and ID fields validate, not that the annual totals are complete; and it is not confirmed that ADES can load this CSV, so expect most early records to be `manual_entry` or rejections until the layout is checked against ADES.
   - **PhilHealth RF-1** (`agency: "PhilHealth", form: "RF-1"`): use the file with PhilHealth's EPRS and record the acknowledgement receipt (ePAR) number. PhilHealth issues that receipt when the premium is paid, so it shows the report was filed and paid, not only that the file loaded; and Linaw's figures are recomputed from monthly basic salary, so confirm they match what you remitted. It is not confirmed that Linaw's CSV matches EPRS's own RF-1 template, so expect typed-in filings or rejections until the layout is checked.
   - **Pag-IBIG MCRF** (`agency: "Pag-IBIG", form: "MCRF"`): use the file with eSRS (employers with at most 30 employees) or your bank's Pag-IBIG upload facility, and record the online payment instruction number (OPIN) or confirmation reference. That number shows the file was validated and a payment set up; it does not show the remittance was posted to your Pag-IBIG account, so confirm that separately. Pag-IBIG's official pages were behind a CAPTCHA when this was researched, so the OPIN and CSV-upload details come from secondary sources and need confirming with Pag-IBIG; it is not confirmed that Linaw's CSV matches their layout.
5. Re-check each period. An accepted record means "this run's file was accepted," not "validation is solved forever." Create a new record each period, and expect a new record whenever payroll data changes, because the record is tied to the exact file.

## When to stop doing this manually

- **Billing**: once you have more than a handful of customers, or once
  renewals become hard to track by hand. Wire PayMongo/Maya.
- **Bank**: once payroll volume or headcount makes manual upload a real time
  cost. Wire `BANK_HOST_TO_HOST_URL`.
- **Gov filing**: the per-form flags above are enough for launch. Move past
  "manual entry" only once the exporters produce BIR's exact ADES-importable
  `.DAT` layout directly (needs a middle-name field and the real byte-level
  spec). At that point filing stops being a manual step at all.

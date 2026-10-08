# Production payroll certification and controlled-GA release gate

**State as of 8 October 2026:** payroll engine and security CI are engineering evidence, **not** independent approval of live payroll or Philippine agency/bank acceptance. Do not call PayrollPH generally available or externally certified on these grounds. Keep real employers in a controlled pilot until every employer-specific gate is signed.

## Evidence layers and release responsibility

| Layer | Existing verification / new coverage | Owner | Acceptance |
| --- | --- | --- | --- |
| Calculation and software quality | CI typecheck, full tests, golden payroll Phase 1/2A/2B/3, pilot QA and security checks | Engineering | Workflow on exact candidate commit passes; changes require another run |
| Real parallel payroll | `npm run payroll:parallel:check`, two distinct employer months, **at least 10 real employees each** for combined GA gate; payroll and canonical GL reconciled separately | Independent payroll checker / employer | Zero unexplained variances, real source reconciliation, signed reviewer evidence |
| Statutory government files | BIR 1601-C, Alphalist; SSS R-3; PhilHealth EPRS/RF-1; Pag-IBIG eSRS/MCRF via actual agency acceptance; BIR 2316 independently reviewed against payroll/employee records | Compliance lead, external reviewer | Acceptance IDs and original receipts in private vault; rejected files corrected and resubmitted |
| Controlled disbursement | Bank/PayMongo low-value approval, accepted and rejected UAT, failure/reversal, payout reconciliation to released payroll | Owner + checker + bank contact | Real counterpart confirmations, no double payment, owner authorization |
| Disaster recovery | Automated isolated CI `backup-restore-rehearsal` **plus** representative, encrypted, independently observed staging restore/rollback | Infrastructure/SRE, privacy officer | Actual bytes and schema restored, declared RPO/RTO tested, separate reviewer evidence; CI alone is insufficient |
| Security and privacy | CodeQL, authentication/security smoke, access review, secret/encryption/retention and incident plan | Security/DPO | Signed independent access/privacy proof tied to candidate release |
| Final business release | Employer-specific certification bundle + independent release committee decision | Employer owner, CPA/compliance, release owner | Explicit out-of-band signed decision after evidence authenticity checks |

**Always separate structural proof from external truth.** A SHA-256 match does not authenticate a signature, bank response, government receipt, reviewer license, or actual payroll amounts. Automation does not disburse funds or submit to agencies.

## Private operator procedure

Follow [private parallel reconciliation](private-parallel-reconciliation.md) and [external-evidence handoff](external-evidence-handoff.md). The existing tools already validate employee and statutory GL arithmetic, mandatory agency receipts and accepted/rejected bank evidence.

Keep a **separate bundle for each actual legal employer**. Never commit real payroll, employee identifiers, bank files, backup images, private manifests or mapping secrets. Use the ignored, encrypted `certification/external-private/EMPLOYER_CODE/` vault and restrictive access controls.

1. Obtain at least two genuine months of incumbent + PayrollPH data. Independently normalize, HMAC-pseudonymize employee keys, and reconcile all canonical columns and ten GL controls.
2. Have a qualified independent reviewer examine source records, year-end/final pay, pro-rated hires, MWE and de minimis treatment, statutory bases and anomalies. Keep signed verification and license proof.
3. Independently validate *current* government outputs with their actual portals and save acceptance receipts, not only local CSV/PDF generation. Validate a genuine BIR 2316 sample separately.
4. Obtain bank-authorized low-value transfer and negative/reversal UAT evidence. Confirm exact legal employer, released amount, provider reference, no duplicate payout and separate owner/checker approval.
5. Rehearse restore from an **encrypted real production-like staging snapshot** to an isolated environment. Capture snapshot, incident and verified restore timestamps; verify totals, schema/FKs and payroll exports, test rollback, compare RPO/RTO to employer-agreed objectives and get an independent reviewer to sign.
6. Copy `certification/operational-evidence-template.json` **and** `certification/acceptance-bindings-template.json` into the private vault. Supply the nine actual operational proof files/hashes, recovery measurements, three distinct role names and issuer-linked government/bank/reviewer evidence IDs, hashes, and references.
7. Run the combined checker locally (replace names and SHA with the actual employer/commit):

~~~bash
npm run payroll:ga:evidence -- \
  certification/external-private/EMPLOYER_CODE/parallel.json \
  certification/external-private/EMPLOYER_CODE/manifest.json \
  certification/external-private/EMPLOYER_CODE/operational.json \
  certification/external-private/EMPLOYER_CODE/bindings.json \
  certification/external-private/EMPLOYER_CODE/files \
  EXACT_40_CHARACTER_REVIEWED_ENGINE_COMMIT_SHA
~~~

The combined command **requires the acceptance-bindings manifest** and rejects a missing, stale, reused or cross-employer government/bank/reviewer reference. See [acceptance binding controls](../../docs/acceptance-bindings.md). Only `evidence-ready-for-independent-final-review` with `gaApproved: false` is a successful automated result. It must not be represented as approval to go live. The separate release committee must authenticate the original evidence, verify source release/version, approve employer scope and record a dated signed out-of-band decision.

## Disaster recovery controls

GitHub's [Isolated Backup and Restore Rehearsal](../../.github/workflows/backup-restore-rehearsal.yml) tests `pg_dump` → `pg_restore` with synthetic entries using a disposable PostgreSQL 16 service, including backup hash tamper rejection, table/row/digest checks, FK integrity and transaction rollback. It uploads **only** `qa-artifacts/dr-rehearsal.json`; no database dump is retained.

That proves engineering mechanics only. It does **not** measure customer production RPO/RTO, retention guarantees, PITR, encrypted storage, geographic failover or recovery of production KMS secrets. Those require an independently witnessed staging drill with agreed objectives. Do not run the CI script against an actual database; it refuses without the isolated CI service context.

## Remaining human sign-offs (cannot be created by code)

- Real employer source reports and two independent payroll cycles, with genuine 10+ employee populations and external professional review.
- BIR 2316 review, government output/schema checks and real portal acceptance receipts.
- Actual bank UAT (positive, negative and reversal cases), safeguarded authorization and reconciliation.
- Production-like encrypted backup restoration, RPO/RTO evidence, rollback and independent DPO/SRE review.
- Final release decision signed for the exact employer, payroll engine commit, calendar and policy rules.

Do **not** check these off merely because automated tests passed. If the release commit changes, rerun the affected tests and obtain reviewer confirmation of what changed.

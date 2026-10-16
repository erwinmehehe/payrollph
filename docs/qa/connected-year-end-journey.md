# Connected synthetic year-end journey

This adds a fourth, explicit `year-end` / governed / PostgreSQL 16 development
case to the existing nine-stage workflow. The three current month-end cases
keep their clock, pay-date behavior and flags unchanged. No production code,
flag defaults, authentication controls or payroll-engine arithmetic changes.

The disposable app and browser share December 31 of the current Manila year.
The pay date is the same December 31, not the following January 1. All original
CI, loopback, empty-database, fresh-anchor and provider-credential prohibitions
remain. Session timestamps are initialized on an empty fixture; live sessions
are never rewritten and maximum/idle-age limits remain in effect.

The SAME governed candidate/worker, Web Bundy punch, approved timesheet and
payroll run continue through these actual application boundaries:

1. The owner completes fictional birth date/TIN through the existing audited
   privacy correction API and configures the legal employer through its API.
   This is evidence of the current correction path, not proof that ordinary
   new-hire intake already captures every certificate field conveniently.
2. Payroll adds a paid 13th-month earning and taxable commission through the
   supplementary-earnings API, invalidating and recalculating the open run.
   The benefit amount uses an independent integer-centavo oracle on earned
   BASIC. It must be present as a paid earning, not an unpaid annual accrual.
3. A payroll maker saves the explicit no-prior-employer declaration. Their
   self-approval is rejected; the distinct owner approves it. Employee access
   is rejected. The new intake flag is enabled only in this disposable case.
4. Annualization is bound through HTTP BEFORE payroll checker review. Its
   queued recalculation is consumed by the real run-scoped queue consumer.
   An actual positive refund line must be posted before existing independent
   checker approval and owner release. This does not test an external cron.
5. Released-source withholding must reconcile to zero annual tax for this
   deliberately below-threshold fictional year. Detail mapping must match
   actual released gross without unpaid benefit accrual. A byte-hashed,
   source-digest-bound unsigned 2316 is generated through HTTP; employee,
   other-tenant and stale-digest requests are rejected. The real preparer UI
   is exercised and captured at desktop and 390px.

The fictional review mapping puts employee contributions in exempt item 36
and removes them once from taxable BASIC, then commission if BASIC is smaller.
Premiums remain separately mapped. An executed preparer test rejects the
original double count and checks the small-BASIC allocation. This is explicit
fictional reviewer evidence, not an automatic production classification or a
claim of tax-practitioner approval for a customer's compensation categories.

The receipt marks annual completion separately from the original nine stages;
wrong-worker PDFs and missing annual receipts cannot pass the evidence test.
The acceptance test independently SHA-256 hashes the **saved PDF bytes** and
checks the year-end UI review scope against the SAME employer/worker/tax year:
a receipt containing only a plausible digest is insufficient. Before saving,
the locally generated PDF must pass HTTP success, PDF MIME, no-store, bounded
8 MiB stream/Content-Length, PDF header/trailer and recognizable active-content
checks. These checks are not a comprehensive PDF malware/security audit; the
unsigned evidence is still handled as untrusted, local QA output.

The optional failure diagnostic now writes only numeric, centavo-normalized
fictional amounts and a bounded error-code count. Raw API response objects,
identities and unvalidated network strings are not written into that diagnostic
or uploaded to the workflow artifact. The fictional PDF itself must be retained
to verify the real HTTP-generated document, so the QA-only network-to-file
CodeQL pattern remains intentional and subject to security review.
The PDF has no signatures and is never submitted. All payment providers remain
disabled, all credentials are fictional, and all data lives in disposable CI.

NOT production evidence: real employer/customer reconciliation, independent
tax review, external scheduler delivery, physical-device/operator UAT, agency
acceptance, certificate signatures or customer delivery. No flags are activated
and no production migrations run. A source merge cannot close those gates.

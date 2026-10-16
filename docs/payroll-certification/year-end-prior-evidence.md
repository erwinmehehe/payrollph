# Previous-employer and PERA year-end intake

Default OFF: `YEAR_END_PRIOR_EVIDENCE_ENABLED=true` is the only enabling value.
Source merge is not migration, production activation, filing or money authority.
Do not enable until synthetic PostgreSQL/browser acceptance, a reviewed migration
receipt, tax-practitioner review and a consenting employer reconciliation exist.

## Supported path

Company-wide payroll operators with recent MFA use
`/workspace/prior-employer?organizationId=…&employeeId=…&taxYear=…`.
The Year-End table links here only with the flag ON. GET and POST use the same
organization/role/custom-permission/MFA scope and no-store responses. Mutations
require same-origin. Both worker and organization must match in the application
and the database composite foreign key.

Record an explicit no-prior-employer declaration, or one sequential prior
employer's certificate, plus a verified PERA **tax credit** if applicable. The
source private reference and SHA-256 must identify the exact reviewed document.
They are attestations, not independent document verification. The app does not
upload, fetch, certify or retain source files. Keep those in the approved private
evidence repository, subject to its access and retention policy.

Taxable income is prior certificate item 21; tax withheld is prior employer's
item 25A. Do not substitute prior combined item 28 or a PERA contribution.
Sources: [BIR September 2021 ENCS Form 2316](https://bir-cdn.bir.gov.ph/local/pdf/2316%20Sep%202021%20ENCS_Final_corrected.pdf)
and [RMC 34-2022](https://bir-cdn.bir.gov.ph/local/pdf/RMC%20No.%2034-2022.pdf).

The payload, including TIN and private references, is AES-256-GCM encrypted using
the dedicated `PII_ENCRYPTION_KEY`; writes require a configured key. Rotation
uses `PII_ENCRYPTION_KEY_PREVIOUS` for reads, then a reviewed rewrite with the
current key. Never remove a previous key until every stored ciphertext has been
re-encrypted and verified. Audit metadata contains IDs/revision only, no TIN,
private reference, uploaded file or plaintext payload. Operational application
users must not have direct SQL access to this table.

Saving increments the revision and clears approval. Another authenticated payroll
operator must approve the exact digest. The digest includes employee, tenant,
tax year, legal entity, employment start and stored employee TIN. Scope changes
invalidate approval. Annualization requires approved evidence for **every**
included employee while enabled. It uses canonical effective-year tax functions:
combined tax due minus prior withholding, PERA and actual present withholding.
Present gross/taxable income and withholding remain present-employer amounts.
The adjustment breakdown binds record ID/revision/digest; unsigned PDF generation
reloads that approved source and rejects edited prior/PERA fields. It neither
signs nor approves a certificate. Final-pay calculations are unchanged.

## Locking and financial boundaries

Intake mutations and annualization share the existing tenant/year advisory lock
inside serializable transactions. Optimistic digests reject stale writers.
Editing/approving is refused once an employee/year adjustment is bound,
approved or settled. Existing settled-year recomputation protection is preserved.
A separate audited correction is required; this feature cannot rewrite settled
payroll. It does not turn an uncollectible amount into withholding. Existing
actual-withholding/shortfall evidence remains the certificate gate.

MWE, multi-entity runtime, overlapping employment, multiple prior employers,
pre-2023 years, and prior credits exceeding annual liability are unsupported and
must be independently reviewed. Refunds are limited to present-employer tax:
prior excess credit cases block rather than refund another employer's tax.

## Schema rollout / rollback

`drizzle/0127_year_end_prior_evidence.sql` is additive, no backfill, no automatic
startup DDL. It relies on the existing unique employees(organization_id,id)
constraint. Use the reviewed exact-main migration workflow and receipt. The
unique (organization_id,employee_id,tax_year) index serves all intake lookups.
Apply first with flag OFF; validate constraints and isolated tenant behavior,
then obtain explicit activation approval. No production migration was run here.

Rollback: turn flag OFF to hide the screen/link and disable intake. Preserve the
table, keys and approved records; do not DROP or delete evidence. **Do not
recompute a computed combined adjustment with the flag OFF**: the legacy path
does not consume prior evidence. Keep prior-bound years on hold until a reviewed
correction/recompute can retain the approved credits. Bound and settled records
remain immutable. The certificate loader refuses a bound prior-evidence source
while its flag is OFF; existing legacy source behavior remains unchanged.

## Acceptance boundaries

Pure behavior tests cover exact collection/refund/balance, declaration/date/hash
validation, source drift/transfers, checker separation, key rotation and PDF
evidence mismatch. Disposable local CI Postgres tests execute the persisted
revision/approval/annualization path and constraints. The component browser
harness executes React at 1280/390 with fictional intercepted API responses;
that harness alone is not authenticated route acceptance. Physical-phone,
screen-reader, customer and tax-practitioner UAT are separate outstanding gates.

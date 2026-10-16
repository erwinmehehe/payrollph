# Unsigned 2316 preparation

## Activation and scope

All three default-off flags are required: `BIR_2316_CERTIFICATE_DRAFT_ENABLED`, `BIR_2316_RECONCILIATION_ENABLED`, `BIR_2316_WITHHOLDING_EVIDENCE_ENABLED`. No production activation is included. The existing multi-entity year-end runtime hold remains enforced. New API/UI are unavailable when disabled; the original text/HTML export behavior remains unchanged. Rollback: disable the new flag; there is no migration or backfill.

Year-end Compliance gains a “Prepare unsigned PDF” link per employee only when enabled. Direct route: `/workspace/2316?organizationId=…&employeeId=…&taxYear=…`. For released final pay add `separationId=…`. Both API verbs at `/api/year-end/2316-certificate` require company-wide payroll operator access, organization session/custom permission policy and recent MFA; POST additionally enforces same origin. No access is granted by entering an employee ID.

## Source and identity

The read-only repeatable-read transaction loads the exact tenant/employee/year or released separation source and its posted withholding together. Final pay compares the full frozen payroll source through the existing withholding verifier. The employer comes from `sourceFingerprint.employeeLegalEntityId`, including inactive historical entities, rather than today's worker assignment or the workspace TIN. The entity must belong to the same tenant and have complete registered identity. Missing explicit entities never fall back. A frozen null ID permits organization identity only when no legal-entity records exist. Legacy snapshots without the frozen employer field block until reviewed; no old immutable snapshot is automatically rewritten.

GET returns a canonical source fingerprint. PDF POST must match that fingerprint after freshly loading the source; changed identities, scope, summary totals or posted withholding require a reload/review. SQL ordering of entry IDs does not invalidate an unchanged source. This token prevents stale preparation; it is not a signature, approval credential or proof that manually entered category references were independently verified.

Legal name/TIN are read from the registry of that historical entity; this is **not** a historical version archive of changes to the entity's registered identity. Reviewer must verify the appropriate registration. Employee name/TIN/birth date come from employee records. Missing birth date is corrected in the source employee record, not silently invented here. Addresses/RDO/contact/employer type are explicit preparer entries. Printed period comes from source employment start and year-end/separation cutoff.

## Explicit review

Enter all 24 compensation item amounts, including explicit zeros, category and PERA evidence references, previous-employer status and PERA credit. Nonzero “other” categories require descriptions. MWE premiums cannot be placed in exempt MWE fields for a non-MWE worker. Item 34 retains its PHP 90,000 cap. Detail totals, combined taxable compensation, actual present withholding, previous withholding, PERA and source tax due reconcile in integer centavos. Browser-provided actual withholding is ignored.

Previous-employer compensation and PERA do not recalculate or overwrite approved annualization. If the approved source does not include their effect, generation blocks. A complete multi-employer annualization intake/calculation workflow is still required separately; do not “fix” the source by editing a reviewed snapshot or substituting client amounts. Unsettled final-pay shortfalls and uncertain imported withholding also block PDF generation.

The existing canonical annual tax function independently checks the source tax due against combined taxable compensation for supported tax years 2023 onward. This is validation only: it never saves a recomputation or calls the payroll engine. This also rejects a nonzero previous taxable amount paired with zero previous withholding/PERA when it would change the approved tax due.

This is a **preparer preview**, not a maker/checker approval or certificate issuance action. Manual references are not independently verified just because they were entered. No review data is stored in localStorage, Documents or payroll tables. Inputs stay in browser memory. The source and output requests are audited by IDs; no TIN or filled PDF content is written to the audit event. Output/source responses prohibit caching.

## PDF and acceptance

Use the unmodified BIR September 2021 ENCS PDF in `assets/bir`, pinned by SHA-256. It has no AcroForm fields, so the overlay is static. Individual detail/summary fields are mapped by coordinates; overflow fails instead of truncating. No signatures, dates of signature or substituted-filing election are filled. The watermark and footer make its unsigned, not-for-filing state explicit.

Executed tests cover mapping, false/missing zero evidence, one-cent variance, prior employer/PERA, exact released withholding, frozen employer/tenant identity, shortfalls and PDF content. Isolated PostgreSQL acceptance verifies read-only loading, disabled no-query behavior, cross-tenant denial and historical employer after transfer/inactivation. Authenticated Playwright covers PDF bytes, input errors/focus, unauthenticated and employee denial, cross-site denial, default-off 404 and desktop/390px form screenshots. No synthetic fixture is customer or agency evidence.

## Still required before issuance

- Responsible tax practitioner review of the completed numbered fields and template alignment.
- Verified combined annualization intake for previous-employer compensation/PERA where applicable.
- Historical registered-identity versioning if the same entity's name/TIN changed; current registry identity is not a frozen identity archive.
- Independent employer/employee review, signatures, substituted-filing eligibility and employee delivery workflow.
- Consenting employer parallel reconciliation, physical-phone/operator UAT and actual applicable agency acceptance.

No claim of BIR approval, filing, bank settlement or production readiness follows from these tests.

# Applicant privacy source-only exception — PR #925

On 13 October 2026 the repository owner explicitly approved: “Approve narrow
source-only exception” in response to a request covering #925's fixes while
keeping production activation, migrations and the rest of the HCM/WFM freeze
unchanged. This records owner policy authorization, not an invented independent
review or a human privacy/UAT certification.

Reviewed source: `2b0c93f768f72541ecf7ecec38d01694ef8dc147`. The policy pins the
entire fourteen-file changed-file list: each path, added/modified status and Git
blob SHA must match. Missing, duplicate, renamed, changed or additional files
restore the normal freeze, including changes to schema, default-OFF flag,
recruiting APIs, SQL proposal, retention, audit-copy hold and behavior tests and the connected browser session-reuse correction.

The complete independently captured list is in
`tests/fixtures/applicant-privacy-source-files.mjs`. Tests execute the read-only
gate with API fixtures, admit the reviewed set, reject per-file mutations and
extra runtime/test/workflow/SQL paths, preserve source sensitivity, and verify
`releaseAuthorized=false` and no fabricated reviewer approval. Strict reviewer
mode still requires its ordinary independent approval.

This exception is effective only after this separate policy PR passes review
and CI and is merged on trusted main. #925 must then pass its own latest-head
source gate, full tests and applicable checks. The exception enables source
integration only. It does not enable `APPLICANT_PRIVACY_CONTROLS_ENABLED`, claim
multi-entity recruitment isolation, allocate/apply a numbered migration,
authorize historical consent backfill, certify DPO notice/identity/hold
procedures, create consent or privacy-action UI, approve real resume deletion,
deploy, touch live PII, move funds or submit filings. Unresolved resume pointers
and retained named audit/Hire evidence intentionally block erasure.

# Public Careers SSR — employer selector isolation, zero-credit review

## Boundary and reason

`/careers?organizationId=...` is an **intentionally anonymous**
published-job board, not a private employer dashboard. It does not and must
not gain private employee, payroll, application or tenant-wide access.
The underlying public API already filters to a single employer and only
published/open requisitions. A selected employer name and its published jobs
are deliberately public when the recruitment privacy gates are enabled.

Before this change, `Number(raw)` coerced ambiguous Next.js search parameters
(including one-item arrays from duplicate-key handling and whitespace) into
valid employer IDs. The SSR now requires **one canonical positive safe-integer
string**, rejecting missing, duplicate, zero, signed, padded, decimal,
exponential, leading-zero and unsafe numeric forms *before* schema/SQL reads.

## Verified source constraints

- Privacy notice and schema readiness must pass before any employer or job SQL.
- The employer display name is selected with an exact organization ID.
- Jobs use `publishedCareersPredicate(organizationId)`; only public
  title, department, description, employment type and job ID are projected.
- No session-based private authorization, applicant data, payroll read, money
  operation, background worker or provider request is introduced.
- The existing EDG-01 publication/unpublication method proof is left unchanged.

## Disposable HTTP proof (independent acceptance still pending)

`scripts/qa/tenant-careers-page-public-boundary-http.mjs` is **read-only**.
The existing EDG-01 workflow first runs its original publication proof on
fictional localhost PostgreSQL 16. The new second-stage proof then reads
the original two attack employers and higher-ID victim from the real database:

- Each of the three anonymous, canonical own-employer SSR requests must
  return HTTP 200, label only that employer, and show *only* its published job.
- Fourteen malformed, missing, unsafe and duplicate selectors must return
  HTTP 404 without rendering the victim's published job or employer name.
- The actual victim's one published/open requisition must appear under its
  own employer; both attackers' unpublished jobs must remain hidden.
- Before/after snapshots of employers, requisitions, applicants, audit,
  employees and payroll runs must be unchanged.
- The test refuses non-local, non-CI, non-PostgreSQL-16 or payment-enabled
  execution before importing the application database.

The workflow checks out and verifies the exact PR head and is triggered by
the changed page, proof or boundary contract. The source hash, proof and
workflow versions are recorded under the public Careers `GAP` entry in
`scripts/qa/tenant-isolation-coverage-manifest.json`.

## Acceptance and follow-up

- This is **not** evidence of a private tenant grant, nor a claim that all
  employer-scoped pages are isolated.
- The manifest keeps the original **21** page/action records and their
  current **17 GAPs / 4 COVERED** statuses as of the source branch.
- A completed exact-head passing PostgreSQL CI run, independent
  security/privacy review, and review of interactions and APIs are required
  before changing any status or claiming production certification.
- The separate billing manage redirect is addressed in draft PR #1950 and
  is not merged or duplicated into this change.

Rollback is to revert the public page selector edit and its source-pinned
proof/inventory changes. Publication policy and private APIs are untouched.

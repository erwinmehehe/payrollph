# Tenant isolation, separate batch: HR Cases staff page and read-only inbox

**DRAFT / 0 new page or method credits / NOT security or production accepted.**

## Why this batch is independent

The coverage inventory on the reviewed main revision still lists
src/app/hcm/hr-cases/page.tsx as a page/action GAP. Existing server-side
authorization checks suggest a correct boundary, but a flag-off 404 does
not prove access to real own data or refusal of populated foreign data.

This batch investigates the HR Cases **staff SSR page** together with its
read-only GET /api/hr-cases inbox. The API's existing classification is not
being changed. This is not a whole-method POST/PATCH test and does not validate
COE issuance, employee case creation, document storage or write transactions.

The change introduces exactly five new, purpose-scoped files: this runbook,
one workflow, a proof contract, a fictional PG16 HTTP runner and contract tests.
No production routes, feature behavior, DB schema, manifest, existing CI jobs,
financial calculations, providers or release flags are edited. It does not
share files with the currently open approvals, billing, readiness or Studio PRs.

## What must genuinely execute

The dedicated workflow checks out the **exact PR head**, confirms source blob
pins, and refuses a non-disposable database, non-loopback server, provider
credentials, live worker or any money/COE feature being enabled. It provisions
fresh PostgreSQL 16 and runs a production-mode Next app **on localhost only**,
with HR Cases temporarily enabled in this disposable test environment.

The runner then checks:

1. Seven populated filler employers before two independently signed-in owners
   and a real higher-ID victim. The victim's employer, owner, unit, worker and
   case IDs exceed both owners and six.
2. Both owners receive HTTP 200 for their actual HR Cases page and populated
   GET inbox. Exact returned case IDs, employee linkage, role, status and real
   private-note sources match PostgreSQL; no other employer markers appear.
3. A unit-scoped HR member sees only the HR case from their own unit, not a
   different-unit HR case or their employer's payroll-assigned case.
4. Actual cross-employer, duplicate, malformed and noncanonical employer
   selectors are denied. A bookkeeper, an anonymous user and an owner whose
   employer membership is revoked cannot read the inbox.
5. Revocation does not need to terminate the owner's signed-in session: the
   same session is still authenticated but no longer has that employer's rights.
6. Ten protected employer-owned tables, including cases, messages, payroll
   runs and audit events, are unchanged before and after all read HTTP
   requests. Only explicit fixture setup and membership revocation may modify
   the database; the baseline is updated after that deliberate fixture change.

The proof runner has mandatory assertions for 3 positive page renders,
3 populated GET inbox reads, 10 real foreign denials and 40 negative requests.
A 404 for a disabled feature or an empty 200 JSON response never counts as a
positive. The helper tests must independently reject forged positives,
wrong-case rows, mismatched employer IDs, cacheable private responses, wrong
status codes, victim markers and unsafe environment changes.

## Acceptance boundary and reviewer checklist

- [ ] GitHub's exact-PR-head node contract/negative-control job passes.
- [ ] Its dedicated production-mode localhost PostgreSQL 16 HTTP step passes,
      with sanitized execution receipt retained.
- [ ] Required standard CI, security, CodeQL and source checks are green on the
      final revision; missing or skipped checks do not count as passes.
- [ ] Independent HCM/HR privacy and tenant-security reviewer checks the
      SQL provenance, unit role boundary, actual foreign denials, membership
      revocation, default-off behavior and affected source pins.
- [ ] Reconcile against newer main and any newly opened overlapping PR before
      a human merge decision.

Even a green fictional proof does **not** promote a method or page to COVERED,
does not establish tenant-wide security or approve production. No live people,
real employee records, provider traffic, payroll release, COE generation,
automation publication, migration, deployment or auto-merge is authorized.

To review: open the PR's **Tenant HR Cases SSR and Inbox (Fictional PG16 Only)**
workflow; inspect the exact head SHA and the terminal synthetic summary; use
this runbook for independent signoff. If a source pin changed, re-inspect the
changed code before adjusting the pin. Do not bypass the failure guard.

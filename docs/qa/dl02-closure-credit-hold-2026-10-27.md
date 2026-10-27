# DL-02 coverage-credit promotion hold — exact-main evidence gates (2026-10-27)

**Decision: BLOCKED / documentation only / no manifest promotion / no batch-complete claim.**

This hold was checked against the repository's actual `main` HEAD
[`403218bb689b27b899517fc97be86a7e5bcf7277`](https://github.com/erwinmehehe/payrollph/commit/403218bb689b27b899517fc97be86a7e5bcf7277),
not against the previously merged PR branch. The hold branch was created
directly at that SHA. PR [#1441](https://github.com/erwinmehehe/payrollph/pull/1441)
is merged, but its passing evidence is tied to a *different* commit.

## Security review gate — resolved review thread (not the blocker)

The [CodeQL insecure-temporary-file review thread for alert #76](https://github.com/erwinmehehe/payrollph/pull/1441#discussion_r4379605453)
in PR #1441 was inspected via GitHub's pull-request review-thread status.
Its `is_resolved` field is **true**, `is_outdated` is true, and
`resolved_by` identifies `github-advanced-security[bot]`.
This is positive confirmation of the review **thread's actual resolution**;
a passing CodeQL workflow alone would not have supplied it. The separate
[alert #76 page](https://github.com/erwinmehehe/payrollph/security/code-scanning/76)
is linked for security review; no claim about the alert record's independent
lifecycle state is made from a thread status alone.

## Blocker 1 — no DL-02 HTTP/PG16 proof run on current main HEAD

The most recent inspected passing
[DL-02 whole-batch HTTP/PG16 run #40430046118](https://github.com/erwinmehehe/payrollph/actions/runs/40430046118)
has `head_sha=5d265cc73424f8d73343daf8ff02e6a50cc550a8`,
the final head of merged PR #1441. The current
[`main` commit](https://github.com/erwinmehehe/payrollph/commit/403218bb689b27b899517fc97be86a7e5bcf7277)
is **`403218bb689b27b899517fc97be86a7e5bcf7277`**, which is not that SHA.
The GitHub Actions run listing filtered to the current main SHA reported
**17 runs, zero DL-02 whole-batch runs**. A passing older PR-head run cannot
satisfy an exact-main-head requirement.

The [DL-02 workflow](https://github.com/erwinmehehe/payrollph/actions/workflows/tenant-dl02-closure.yml)
is configured for `pull_request` and `workflow_dispatch`, not `push`.
**Required action:** explicitly dispatch it on `ref=main` while that ref
still names the targeted commit; verify the resulting workflow run's
`head_sha` exactly matches the then-current `main` SHA, and confirm the
actual four-method, two-attacker, real-victim, unchanged-DB and
forged-selector HTTP/PG16 assertions **passed**. If main moves during
verification, rerun on the new head instead of reusing old proof.

## Blocker 2 — required full CI/check is not passing on that head

[Full CI run #40430116863](https://github.com/erwinmehehe/payrollph/actions/runs/40430116863)
is tied to `head_sha=403218bb689b27b899517fc97be86a7e5bcf7277`, but was **queued**, with no successful
`CI/check` / PG16+PG18 regression and audit-matrix receipt at inspection.
**Required action:** wait for that exact-head CI/check to finish successfully;
if it fails, fix and rerun against the new exact main SHA. Do not substitute
[#1441's passing CI run #40424935916](https://github.com/erwinmehehe/payrollph/actions/runs/40424935916),
which belongs to `5d265cc73424f8d73343daf8ff02e6a50cc550a8`.

## Credits and batch sequencing held unchanged

The four deferred DL-02 methods are:

- `POST /api/self/photo`
- `GET /api/web-bundy/evidence`
- `POST /api/web-bundy/evidence`
- `POST /api/workforce/demand-observations/import`

**No entries have been promoted to COVERED in**
`scripts/qa/tenant-isolation-coverage-manifest.json`.
**No DL-02 completed status, batch reconciliation, or global counts have been
changed** in `docs/engineering/tenant-isolation-closure-plan.md`.
The plan's previous 22 COVERED / 4 GAP DL-02 snapshot is not a substitute
for a fresh reading of the current live manifest.

Before any later promotion PR, check the **current live DL-01 manifest rows**;
do **not** infer DL-01 closure from the docs-only
[PR #1439](https://github.com/erwinmehehe/payrollph/pull/1439)
or label DL-02 the second complete batch without verifying that predecessor.
Once both exact-head gates above are green, independently inspect the
corresponding `scripts/qa/tenant-dl02-rows/*.mjs` method-level assertion
lines, recorded workflow receipts and true live counts before creating
a **separate review-required promotion PR**. No merge or independent
security/release acceptance is authorized by this document.

**Environment restriction:** disposable PG16/PG18, synthetic identities,
localhost HTTP only. No Neon, production, real employees, financial transfers
or external provider calls.

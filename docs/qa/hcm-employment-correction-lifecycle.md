# #601 employment-type correction lane

This draft implements one source-specific send-back/resubmission flow. It does not close #601 or implement general rescind, position, compensation, hire or termination corrections.

## Authority and state

An unapplied, unapproved `worker_effective_change` containing **only** employment-type intent can be returned by its currently assigned independent reviewer/approver. A company-wide People role, existing permission gates, sensitive-action MFA, same-origin protection, rate limit and existing multi-entity holds remain required. Public demo accounts cannot mutate this flow.

`POST /api/hcm/effective-change-corrections/return` accepts `organizationId`, `changeId` and a 10–500 character `note`. Process/source rows are locked, employer/worker/current-step/task bindings are verified, and the existing cancellation routine terminates the old approval run. Its completed historical steps remain intact; pending approval tasks and waiting/pending steps are cancelled. The **source** becomes `returned_for_correction`. This is distinct from decline or ordinary source cancellation. An atomic audit event records reviewer, requester, original process/step, reason and a SHA-256 fingerprint of original source/target snapshots. No new SQL schema is required: the source status fits its existing varchar; the old BP uses its existing terminal `cancelled` state.

`POST /api/hcm/effective-change-corrections/resubmit` accepts `organizationId`, `changeId`, corrected `reason` and `effectiveDate`. Only the original requester can resubmit. A uniquely matching independent-return receipt and original snapshot hash are mandatory. The request's source worker/current assignment/position must still match its frozen evidence; drift requires a fresh fully validated request. At least the reason or date must change; dates must be real and no earlier than the current Philippine business date. The target employment type is retained, not edited through this lane.

Resubmission creates a **new source ID and new BP instance** under the currently applicable policy, beginning at step zero with fresh deadlines, pending tasks and independent approval. No prior approval/apply fields are copied. The old source and old process history remain unchanged. Frozen new-process source evidence and the atomic resubmission audit link both revisions. Under the original-source lock, one return receipt can produce only one resubmission. The existing active-worker constraint also refuses conflicting fresh requests. A cancelled old task cannot approve the replacement request.

Neither endpoint applies the change, releases payroll, recalculates pay, sends funds, or changes activation flags. Normal later independent approval and the existing effective-date application gates still govern the new request. Only correction reason/date are editable here; other source families and intent changes need their own governed validation.

## Worker UI

The existing worker history offers “Return for correction” to another maker's pending employment-type request, and “Correct and resubmit” on the original maker's returned request. These controls are additionally hidden without existing manage permission. The server remains authoritative about exact current assignment and eligible source shape. Forms use explicit labels, bounded reasons, pending/error feedback and employer/worker-bound action-result verification. Component identity is keyed by employer, change and user; late responses after unmount cannot refresh a different employer. Unverified/foreign/malformed results never become a success state.

The maker sees the original reviewer's note from a separate company-wide People-authorized `GET /api/hcm/effective-change-corrections?organizationId=…&changeId=…`. Both sides of the source/audit join are employer-qualified, and the stored return fingerprint/requester must match the original snapshots. Missing/ambiguous evidence is unavailable, never a fabricated empty reason. The form refuses resubmission until the employer/worker/change-bound note is verified. The new source also records `correctionOfChangeId` so worker history can link the replacement instead of offering a spent return again.

## Executable evidence

- `tests/hcm-effective-correction-policy.test.ts`: bounded rationale/date, source subtype/target consistency, no approval/applied history and snapshot fingerprint.
- `tests/hcm-effective-corrections-pg.test.mjs`: fictional guarded localhost PostgreSQL tests for self/foreign/unassigned refusal, audit-failure rollback, corrupt foreign task links, concurrent return/resubmit, requester/replay/date/source-drift/receipt checks, fresh independent steps, immutable prior history and final-approval races. Runs explicitly in the existing default-profile disposable tenant-table CI job. It does not operate on a live employer database.
- `scripts/qa/tenant-table-rows/{read,write}/hcm-corrections.mjs`: real authenticated HTTP for the reason GET and both writes, two attacker employers, genuine higher-ID victim employers, own identity-bound read and persisted source/process/task/audit expectations, forged write resource rejection, discrimination and unchanged victim DB/audit. Separate fictional workers avoid hiding the existing one-active-change constraint.
- `tests/hcm-correction-action-read.test.ts` and `tests/hcm-effective-correction-ui.test.ts`: action-result identity checks, maker/checker control visibility and form/render contracts. Interactive browser acceptance is recorded separately; source/render tests do not claim it.
- `tests/tenant-hcm-correction-credit.test.mjs`: fail-closed family selection and isolated writer proof that selected new methods preserve every unrelated method's provenance. Route/method totals are derived by the existing credit writer, not manually guessed. These are **three new methods**, not recovery of three older GAP methods. Historical 124/359 recovery accounting remains pinned; the new methods are separately excluded from its legacy-GAP arithmetic. The structural inventory additionally requires the three exact new methods and their real delegated gates, retaining a strict 498-method ceiling.

The family selector is identical to the independently developed #1427 helper; it is reused for bounded local evidence and is unset in complete CI profile runs. Existing cited shared assertion text/line numbers are retained. No unrelated family rows change. Credits require real final-head HTTP execution and fresh CI review; global tenant-isolation acceptance is not claimed.

## Remaining boundaries

General source correction/resubmission, rescind, changes to corrected target fields, scoped-manager UI, external HR/legal acceptance, and end-to-end real-employer rehearsal remain open. This PR is source delivery and fictional evidence, not production activation. Rollback is a source revert; never rewrite or delete correction audit/source history to undo a request.

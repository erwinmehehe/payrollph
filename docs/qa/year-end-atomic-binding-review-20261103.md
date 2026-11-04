# Year-end payroll binding: atomicity review candidate (2026-11-03)

**DRAFT / SOURCE CHANGE ONLY / NOT MERGE-CLEARED / NOT PAYROLL-ACCEPTED.**

## Existing defect

The year-end POST previously committed annualized adjustments in a serializable
transaction, then independently requeued the final payroll run, then inserted the
"Year-end tax adjustments bound to payroll" audit on another connection. An error
in the last step could return an error after adjustment and queue writes were
already committed. An earlier failure of the requeue could likewise leave
annualization committed but not queued.

## Candidate remedy

- Add an optional parent transaction to `enqueuePayrollRun`; standalone callers
  continue using their existing internally atomic queue transaction.
- Add an `onBoundToPayrollRun(tx, summary)` callback **inside** the existing
  serializable annualization transaction, after adjustment and audit writes.
- Fail closed before annualization if a caller supplies a binding run without the
  matching included run and the completion callback, or supplies a callback
  without a binding. Recheck the December 31 cutoff in the serializable
  database snapshot rather than trusting an earlier HTTP preflight.
- The bound year-end POST performs queue/reset/job insertion and its second audit
  inside that same parent transaction. Any audit, queue or SQL failure should
  abort the annualization and payroll requeue together.
- Do **not** change tax calculations, the maker/checker permission and MFA gates,
  provider flags, payouts, payroll release, statutory filing, or migrations.

## Required independent evidence before merge

1. Disposable PostgreSQL 16 real-HTTP positive: two separately authenticated
   fictional employers complete a legitimate year-end apply/bind flow, see
   persisted adjustments and a single queued job, and retain exact audit rows.
2. Force a failure of the **last binding audit**. Verify the prior adjustment,
   payroll-run status, payroll-entry rows, queue jobs and all affected audit rows
   are **byte-identical** before and after the refused transaction.
3. Force queue/job insertion failure. Confirm the same full rollback, including
   any deleted/replaced annual adjustments.
4. Repeat for concurrent apply requests and a genuinely populated, higher-ID
   foreign employer. Check 403/404/409/422 denial, forged employee/run selectors,
   unchanged foreign SQL/audit, and no response-data disclosure.
5. Verify the stand-alone enqueue callers retain their existing atomic guards,
   payroll-month certification veto, release-state refusal and worker behavior.
6. Exact-final-head CI, payroll isolation, security smoke, CodeQL and reviewer
   acceptance are required. The source-contract unit test alone is insufficient.

No production/Neon database, real employee/payroll data, workers, bank or agency
calls, payout/provider credentials, actual money movement, feature activation
or deployment is authorized by this draft.

## November 4 ledger source-supersession review

The merged `main` includes 407 provisional COVERED / 81 GAP methods, including #1749 payout PATCH. The changed `/api/year-end` handler invalidates both historical #1730 source-specific GET/POST receipts. This draft intentionally reports **405 COVERED / 83 GAP**, with the changed pair GAP and zero current credits; the unchanged prior-evidence pair and payout method retain their original exact-source evidence. The shared anti-downgrade invariant now permits only this exact, paired, old/new Git-blob-pinned evidence supersession and rejects all other downgrades. This is no new proof or certification.

[Prior-head fictional PG16 atomic rollback and concurrency run](https://github.com/erwinmehehe/payrollph/actions/runs/41752747046/job/126321535094) passed with two independent employers, populated higher-ID victim, separate injected audit and queue failures, full SQL rollback and one successful concurrent binding. Its actual runner reported `methodCredits: 0`. Repeat exact-head CI and full method-specific HTTP acceptance, then obtain independent financial/security review before any credit restoration, merge or deployment.

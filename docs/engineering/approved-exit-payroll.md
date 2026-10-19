# Approved exit payroll handoff — default OFF

`APPROVED_EXIT_PAYROLL_ENABLED` requires the exact value `true`. Production activation is not included in this PR.

The ordinary payroll scope includes Separating workers whose exit intersects this or a later cutoff. Missing approval or maker/checker identities blocks calculation explicitly. A final-pay package containing unpaid basic wages also blocks ordinary payroll until that potential duplication is resolved and independently reviewed. Workers with an already-past recorded exit are excluded from later cutoffs. Tenant/legal-employer/unit predicates remain in place.

When enabled, existing fixed-pay proration receives the approved end date; punches and unworked holidays are bounded by it. The rate selected for deductions and other current-profile calculations is the profile effective on or before that date, including when a later revision falls inside the cutoff. This does not change statutory rate tables.

The released payroll trace binds the feature version, separation ID and employment end. Final pay accepts a crossing cutoff only when that exact trace matches a same-employer, same-worker separation record and last day. Legacy or ambiguous crossing rows still fail closed. Recomputed final pay includes those released wages once in YTD and rejects adding them again as unpaid basic salary. Recomputation resets financial approval; released payroll is unchanged. A final-pay release without last-day wage evidence or reviewed unpaid basic wages is blocked.

Operational sequence: apply independently approved termination intent; prepare the final-pay package with no overlapping ordinary wages; complete departmental clearance and distinct-checker financial review; calculate/review/release ordinary payroll; recompute final pay from its released wages and obtain fresh financial approval. A package already containing unpaid basic salary must be reconciled before using the ordinary-payroll path. Separately owed earlier wages need non-overlapping evidence; this change does not infer them from a manual amount.

Flag-off testing executes the pinned pre-feature calculator and compares complete outputs, including trace/payslip text. The HTTP/PG test seeds fictional prior termination-intent approval, then executes real Separation POST, actual Separating status, explicit unapproved-run failure, real clearance and distinct-checker HTTP decisions, queue calculation, a synthetic internal release and final-pay recomputation. It is not human termination approval, ordinary-payroll HTTP checker/MFA acceptance, statutory certification, payment or agency submission. No production database is used.

Rollback: leave the flag OFF before activation. After any flagged payroll is released, do not switch off without reviewing its final-pay handoff: legacy final pay deliberately rejects crossing cutoff rows. Preserve released evidence; never rewrite it to force rollback.

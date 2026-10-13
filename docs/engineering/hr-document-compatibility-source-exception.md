# Owner-approved legacy document compatibility exception for #888

Owner explicitly approved the narrow exception in the Codex chat on 2026-10-13. It only admits the modified blob `49957255191041ee83440bd7f24ea5cfd72d491c` of `src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts`. Its source change replaces the expanded A5 documents ORM import with the existing legacy-compatible mapping, preventing disabled-vault uploads from referencing unapplied columns.

The classifier rejects missing/changed hashes, different statuses, duplicate copies, renames and every additional frozen HCM/WFM path. Nonfrozen changes remain subject to all normal CI and source checks. The trusted-main workflow reads this decision; #888 cannot admit itself through its own policy edits.

This does not start a pilot, lift the general freeze, apply SQL, enable HR cases or document storage, certify a scanner/provider, approve personnel changes or authorize payroll/payout/filing. All production flags remain default-off. The executed rollback-only synthetic PostgreSQL legacy-schema test is in #888, alongside API and React flag-off tests.

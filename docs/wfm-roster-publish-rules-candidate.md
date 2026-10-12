# WFM rule-checker candidate (default OFF)

UNNUMBERED SQL DESIGN ONLY: `docs/engineering/migration-proposals/wfm-roster-publish-policies.sql`. Do not apply or enable by merging this PR. First reconcile this parallel roster policy schema with canonical `0116_wfm_roster_scale_rules.sql` in #865 and #859, then obtain a DBA-approved post-train migration if needed.

Uses the existing locked schedule assignment/override flow; adds company-configurable daily, weekly and rest controls and an optional approved overtime cap. Baseline thresholds (12h/day, 48h trailing-week, 8h between shifts) are **illustrative employer policy safeguards**, not a universal assertion of Philippine statutory limits or permission to underpay.

Overlap remains an absolute blocker. Approved overtime cap remains blocking; other blocking company-policy thresholds can only be overridden by an authorized company-wide People administrator with a >=20-character recorded reason. Holiday/rest-premium advisories are hints for manual payroll review, never computed wage deductions.

Acceptance target: 13h shift followed by 5h rest yields exactly two findings: daily cap 780>720 minutes and minimum rest 300<480. Additional tests check OT cap, override separation and holiday warnings.

**Not certified:** Philippine labor-law policy validation, published rostering user workflows, premium rate reconciliation, 1,000-row clock watch hardware/ops acceptance, independent manager UAT, or completion of Task 6 auto-scheduling. Run tsc, lint, golden payroll suites, full TZ=Asia/Manila test suite before review.

# Parallel People Operations UX — independent no-money acceptance packet

Status: **TEST CANDIDATE / HUMAN UAT NOT RUN / NO REAL PAYROLL CERTIFICATION**.
Source baseline at creation: `2026c5490be61086b626e0269259e0172205557c` (1 November 2026, Asia/Manila). The three feature branches are independent candidates and are **not** merged into this QA branch.

## Scope and roles

This packet checks the existing feature boundaries that the following draft PRs must preserve when considered independently:
- First Payroll journey (draft #1687): one guided, role-aware navigation shortcut, without changing payroll readiness or release.
- HR Work Queue (draft #1688): search only the verified employer's loaded case list, mobile assignment and honest unknown/error states.
- WFM manager triage (draft #1689): read-only source signal filtering, strict dates and unavailable-source warnings.

Use fictitious Employer A and Employer B, same synthetic case/worker IDs where possible, and company-wide HR, manager, payroll-only, checker and employee roles. Never include real identifiers, pay amounts, personal documents or authentic bank data in source-controlled artifacts.

## Automated source checks (candidate, not certified)

Command: `TZ=Asia/Manila npx tsx --test tests/parallel-people-ops-no-money-acceptance.test.ts`.

1. A's verified HR response is denied under B; mixed-employer rows fail verification. Pending/denied reads do not display zero.
2. A complete setup checklist does not mark attendance reviewed, payroll approved or filings accepted.
3. WFM source projection discards worker-level PII and marks missing sources unknown.
4. The existing screens remain scoped and the WFM manager triage contains no mutation request.

Record the actual exit status and exact checked commit before claiming an automated PASS. This suite does not authenticate real HTTP roles, exercise payment services, or sign off physical devices.

## Human acceptance to run independently

| Lane | Case | Expected behavior | Current evidence |
| --- | --- | --- | --- |
| First payroll | Owner 375px/390px; new employer vs setup complete | Next permitted action only; no implied approval or release | **NOT_RUN** |
| First payroll | Payroll/checker distinct users | Maker/checker separation preserved; no action without server authorization | **NOT_RUN** |
| First payroll | Employer A → B → A | Old inline saved progress or financial preview never shown under B | **NOT_RUN** |
| HR work queue | HR searches title, team, owner; no matches | Only loaded verified work items; honest matching count; no private case-detail search | **NOT_RUN** |
| HR work queue | 375px/390px keyboard and VoiceOver/TalkBack | Mobile case cards readable; assignments reachable; dialog and retry usable | **NOT_RUN** |
| HR work queue | HR A → B → A with duplicate synthetic IDs | No stale case or editor, no mixed-employer response | **NOT_RUN** |
| WFM manager | Overdue attendance + timecard blockers | Urgent/review filters show source-grounded counts, and links open correct authorized source | **NOT_RUN** |
| WFM manager | Source unavailable or network interrupted | Partial/unknown never shown as zero, cleared or payroll-ready | **NOT_RUN** |
| WFM manager | Invalid leap day/reversed dates, mobile resize | No stale selected period displayed; no mutating action occurs | **NOT_RUN** |
| Cross-module | End-to-end fictional hire → time → review → record-only payroll release → draft export | Must be independently witnessed; source unit tests are **not** completion of nine-stage UAT | **NOT_RUN** |

## Integration and release gates

- Check exact-current-head CI, TypeScript, lint, security checks and relevant golden payroll suites **per PR**.
- Test with two actual signed-in fictional employers, owner/HR/manager/payroll/checker scopes, and role changes. The pure helper suite alone cannot certify authenticated APIs.
- Compare changed files across all open PRs. Merge separately only with owner-reviewed diffs; no bulk feature activation.
- Keep database migrations, Neon/production operations, real employer data, bank/payment execution and government filings out of this work.
- Keep physical-phone and novice-user UAT marked **NOT_RUN** until observed by independent humans.
- Source rollback is simply reverting the corresponding isolated PR; no database rollback needed in these UX candidates.

Linked gates: [#1656](https://github.com/erwinmehehe/payrollph/issues/1656), [#691](https://github.com/erwinmehehe/payrollph/issues/691), [#993](https://github.com/erwinmehehe/payrollph/issues/993), [#579](https://github.com/erwinmehehe/payrollph/issues/579).

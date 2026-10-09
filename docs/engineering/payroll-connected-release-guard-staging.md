# Payroll-connected HRIS/WFM/HCM **release enforcement** — staged candidate

**Draft stacked on #685. NO-GO for merging or enabling in production without independent payroll, HR/WFM, security and DBA acceptance.** This is a staged enforcement candidate, NOT certified Philippine payroll.

## What it checks

The release rule uses the actual payroll register and a successfully completed payroll job. **Freshness is measured from when that job was queued**, not from its completion time: this conservatively flags changes made during payroll chunk processing. It does not rely on the date the run was first opened.

- Calculated employee IDs must exactly match live, eligible company-wide employees (Active, start date on or before cutoff end). Missing or duplicate employees block release.
- HRIS worker changes due in the cutoff must be applied. Applied changes **after the latest completed calculation** block release.
- Payout destination changes pending review, approved without application evidence, or applied after calculation block release. No bank details, source records or PII are exposed in gate messages.
- WFM attendance corrections pending or applied after calculation block release; open attendance exceptions marked \`blocker\` block, informational/warning exceptions remain flagged for review; the **latest** timesheet version must be approved when submitted.
- HCM scheduled/approved/failed compensation proposals effective by cutoff end block until applied; proposals merely proposed or pending approval are review items, **not payable salaries**. Pay and rest-day revisions recorded after calculation and effective by cutoff end block.
- A missing/invalid payroll job completion timestamp or query cap overflow blocks release. Source queries are **tenant-filtered and payroll-population-filtered**.
- Historical org-unit- or legal-entity-scoped payroll runs are intentionally not supported by this release gate and **fail closed** if the tenant is enabled. Do not use current org-unit assignments as a substitute for historical assignment evidence.
- Unlinked legacy pay revisions are not presumed unauthorized.

## Release phases

When the policy is enabled for an explicitly allowlisted tenant, the source check is evaluated:

1. In the existing payroll release checklist (\`connected\` blocking item).
2. Before the payroll operator submits the run to an independent checker.
3. Before the independent checker approves the run.
4. After the atomic \`Ready for release → Releasing\` claim and before calling settlement. On failure, restore \`Ready for release\`; no settlement or payout is performed.

The default-off code path leaves the release checklist and existing workflow semantics unchanged.

## Activation controls

Both are required:

- \`PAYROLL_CONNECTED_IMPACT_ENABLED=true\`
- \`PAYROLL_CONNECTED_RELEASE_GATE_ENABLED=true\` **and**
  \`PAYROLL_CONNECTED_RELEASE_GATE_ORGANIZATION_IDS=<staging tenant id>\`

The allowlist accepts positive numeric organization IDs separated by commas, with **no wildcard or global all-tenants activation**. An absent/empty list means no tenant activates the release gate. Start with exactly one synthetic staging employer. Enabling the release gate while connected impact inspection is off must block release for the allowlisted tenant, not silently bypass source validation.

No money-moving operation, salary change, payout destination approval or database migration is implemented here. Independently review feature-flag access and production deploy practices before any activation.

## Mandatory isolated staging acceptance matrix

| Case | Expected |
| --- | --- |
| Both flags absent, existing release/checker flow | Identical baseline behavior |
| Gate flag true, no allowlist or wrong tenant | Identical baseline behavior for nonallowlisted tenant |
| Gate and allowlist enabled, impact inspection off | Block, configuration evidence unavailable |
| Unsupported branch/legal-entity payroll | Block; no all-clear |
| Clean company-wide payroll with completed job | Connected release gate passes; **not legal/regulatory certification** |
| No completed job, incomplete employee count/chunks | Block |
| New hire after calculation / separated employee no longer eligible | Block roster mismatch |
| Applied HR/pay change before the job was queued | Not stale merely because run was opened earlier |
| HR/pay, WFM or HCM change after calculation was queued, including mid-job | Block pending recalculation and checker signoff |
| Correction pending, attendance blocker event open | Block |
| Attendance warning event open | Review item, existing WFM policy still authoritative |
| Stale later timesheet after earlier approved timesheet | Block |
| Unapproved compensation proposal | Review-only; no proposed raise applied |
| Approved salary change effective this cutoff but unapplied | Block |
| Retroactive salary/rest-day revision recorded after calculation | Block |
| More than 500 rows per relevant source | Block with incomplete evidence |
| Concurrent alteration after release-screen precheck but before release claim | Must be detected by postclaim recheck if committed before that read |
| Tenant-crossing payee/employee source or ID | No data leaks; only bound employer employee IDs considered |
| Exact-head CI, security, race and database review | Green and independently accepted, or NO-GO |

## Known release-critical limitation — concurrency

The postclaim check **narrows but does not eliminate** a time-of-check/time-of-use race: HR/WFM/HCM source writers do not currently participate in one common, locked source-version manifest transaction with financial settlement. A source write that commits after the last postclaim check could still escape this gate.

**Therefore, approval to merge/activate this code requires a follow-up accepted design** for a signed input-source/version manifest bound to the approved payroll calculation and validated with coordinated transactions or locks at settlement. Do not describe this candidate as fully race-safe or as a sufficient control for live bank disbursement.

Additional residual gaps: edits to payroll-affecting data not represented by the covered source tables, effective-dated branch/legal-entity assignments, all-employee timesheet coverage on employers whose existing policy is advisory, and row-cap pagination for employers with larger employee populations.

## Release/no-go rules

- Do not merge stacked enforcement before #685 has exact-head independent review and acceptable staging evidence.
- No financial PR integration (#640/#666/#667/#668), migration, live payroll activation, payouts or government-submission automation in this change.
- Run independent payroll test vectors including mid-period hires/separation, shifts crossing midnight, leave overlaps, tax tables, rest-day premiums, and retro corrections.
- Reconcile against an independently prepared Philippine employer payroll period; all high-impact exceptions must be explained by authorized staff.
- Preserve the existing immutable released-payroll and independently approved correction paths.

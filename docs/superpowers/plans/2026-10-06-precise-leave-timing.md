# Precise Leave Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit full-day, first-half, second-half and custom-hour approved leave evidence so WFM can reduce only the affected scheduled capacity without guessing from aggregate leave days.

**Architecture:** Keep `leave_requests` as the existing approval/payroll header and introduce immutable interval-set revisions as WFM timing evidence. Resolve intervals against authoritative scheduled segments through a pure overlap engine; legacy requests without precise intervals continue through #474's safe full-day/ambiguous behavior. Payroll pay treatment remains unchanged until separately proven by payroll-specific tests.

**Tech Stack:** Next.js App Router, TypeScript, React 19, Drizzle ORM/PostgreSQL, existing workforce scheduling resolver, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-06-worksite-eligibility-precise-absence-design.md`

## Global Constraints

- Execute after PR #478 and the Worksite Eligibility Hardening plan are merged/rebased; use migration `0058_hcm_precise_leave_intervals.sql`.
- Preserve existing `leave_requests.days`, leave-policy pay treatment, approval tasks and payroll behavior.
- Do not infer four hours from `0.5 days`; legacy aggregate-only partial leave remains ambiguous.
- New partial leave must use `first_half`, `second_half` or `timed` interval evidence.
- `first_half`/`second_half` derive from scheduled paid work minutes; if no schedule exists, submission/approval must surface an evidence error rather than assume 08:00–12:00.
- Custom timed intervals are exact wall-clock absence evidence. Existing shifts know total break minutes but not break placement; when a timed interval intersects a shift whose unpaid-break placement is unknown, report conservative unavailable wall-clock overlap plus `BREAK_PLACEMENT_UNKNOWN` instead of claiming exact paid-minute overlap.
- Overnight and split-shift schedules must be tested.
- Approval/revision/withdrawal must stale overlapping submitted/approved timesheets and preserve original interval revisions.
- Never delete punches or automatically suppress statutory/payable work because leave overlaps actual attendance.
- No Automation Studio expansion in this plan.

## Review Focus

- Half-day leave on a split shift: partition scheduled paid minutes in segment order, not by a fixed clock midpoint.
- Timed leave crossing midnight: map to correct work date/next-day wall-clock interval and only overlap matching scheduled segments.
- Timed leave overlaps a shift with unknown break placement: surface `BREAK_PLACEMENT_UNKNOWN`; do not silently claim exact paid-minute subtraction.
- Existing approved `0.5 day` request with no interval set: remain legacy ambiguous and do not acquire fabricated times.
- Leave is revised after an approved timesheet exists: old interval revision remains immutable and the overlapping timesheet becomes stale.

---

### Task 1: Add immutable leave interval-set revisions

**Files:**
- Create: `drizzle/0058_hcm_precise_leave_intervals.sql`
- Modify: `drizzle/baseline.sql`
- Modify: `drizzle/README.md`
- Modify: `src/db/schema.ts`
- Test: `tests/workforce-absence-intervals.test.ts`

**Interfaces:**
- Produces:
  - `leaveRequestIntervalSets`: `id, organizationId, leaveRequestId, revision, status("current"|"superseded"), createdByUserId, createdByName, createdAt, supersededAt`.
  - `leaveRequestIntervals`: `id, organizationId, intervalSetId, workDate, kind("full_day"|"first_half"|"second_half"|"timed"), startLocalTime, endLocalTime, endsNextDay, timezone, source, createdAt`.
- One current interval set per leave request; old sets are immutable/superseded.

- [ ] **Step 1: Add failing source/schema tests**

Assert exact table/type names, allowed kinds, revision uniqueness and one-current-set constraint.

- [ ] **Step 2: Run the targeted test**

Run: `npx tsx --test tests/workforce-absence-intervals.test.ts`

Expected: FAIL because interval tables/types do not exist.

- [ ] **Step 3: Add migration and Drizzle schema**

Use organization-scoped foreign keys/indexes. Timed rows require both local times; non-timed rows require null local times. `endsNextDay` is allowed only for `timed`.

- [ ] **Step 4: Run DB validation**

Run: `npm run db:push`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0058_hcm_precise_leave_intervals.sql drizzle/baseline.sql drizzle/README.md src/db/schema.ts tests/workforce-absence-intervals.test.ts
git commit -m "feat: add precise leave interval revisions"
```

### Task 2: Build the pure leave-interval resolver

**Files:**
- Create: `src/lib/workforce-absence-intervals.ts`
- Modify: `src/lib/workforce-absence.ts`
- Test: `tests/workforce-absence-intervals.test.ts`
- Test: `tests/workforce-absence.test.ts`

**Interfaces:**
- Consumes: `ResolvedDailySchedule["segments"]` from `@/lib/workforce-scheduling`.
- Produces:
  - `validateLeaveIntervals(intervals): { ok: boolean; errors: string[] }`
  - `resolveLeaveIntervalsForSchedule({ workDate, intervals, schedule }): { unavailableWallMinutes, unavailablePaidMinutes: number | null, partiallyAvailable, blockers, warnings, segmentImpacts }`
  - exact finding code `BREAK_PLACEMENT_UNKNOWN` when custom timed leave overlaps a shift with nonzero `breakMinutes` but no scheduled break clock range.

- [ ] **Step 1: Write failing pure tests**

Cover:
- full day;
- first half and second half on a single shift;
- first/second half on split shifts;
- timed interval within a shift;
- timed interval crossing midnight;
- no schedule for half-day;
- overlapping intervals rejected;
- unknown break placement warning.

- [ ] **Step 2: Run targeted tests**

Run: `npx tsx --test tests/workforce-absence-intervals.test.ts tests/workforce-absence.test.ts`

Expected: FAIL because resolver does not exist.

- [ ] **Step 3: Implement interval validation and schedule overlap**

Use schedule segment order and actual start/end/spans-midnight data. Do not manufacture a break clock range.

- [ ] **Step 4: Preserve legacy fallback**

Keep #474's `approvedLeaveCoverageImpact()` for requests without current interval evidence.

- [ ] **Step 5: Run targeted tests**

Run: `npx tsx --test tests/workforce-absence-intervals.test.ts tests/workforce-absence.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workforce-absence-intervals.ts src/lib/workforce-absence.ts tests/workforce-absence-intervals.test.ts tests/workforce-absence.test.ts
git commit -m "feat: resolve precise leave against workforce schedules"
```

### Task 3: Add a schedule-aware leave preview endpoint

**Files:**
- Create: `src/app/api/leave/preview/route.ts`
- Create or modify: `src/lib/workforce-schedule-evidence-server.ts`
- Test: `tests/leave-precision-api.test.ts`

**Interfaces:**
- Produces:
  - `loadResolvedEmployeeSchedule({ organizationId, employeeId, workDate }): ResolvedDailySchedule`
  - POST `/api/leave/preview` input: `{ organizationId, employeeId, intervals }`
  - response per date: resolved schedule, worksite/timezone, segment impacts, blockers/warnings and planned unavailable minutes.

- [ ] **Step 1: Write failing preview API/source tests**

Assert auth, tenant/scope checks, no cross-employee exposure, schedule resolution and explicit no-schedule blocker for half-day modes.

- [ ] **Step 2: Run targeted tests**

Run: `npx tsx --test tests/leave-precision-api.test.ts`

Expected: FAIL because preview route/helper do not exist.

- [ ] **Step 3: Extract reusable schedule evidence loader**

Reuse the same assignment/pattern/override/worksite resolution rules already used by WFM; do not create a second scheduling algorithm.

- [ ] **Step 4: Implement preview route**

Require same-origin for mutation-like POST preview, authenticated workspace access and employee scope. Return evidence only; no database mutation.

- [ ] **Step 5: Run targeted tests**

Run: `npx tsx --test tests/leave-precision-api.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/leave/preview/route.ts src/lib/workforce-schedule-evidence-server.ts tests/leave-precision-api.test.ts
git commit -m "feat: preview precise leave against schedules"
```

### Task 4: Persist precise intervals on leave submission and revision

**Files:**
- Modify: `src/app/api/leave/route.ts`
- Modify: `src/app/api/approvals/[id]/route.ts`
- Test: `tests/leave-precision-api.test.ts`
- Test: `tests/hcm-absence-wfm-integration.test.ts`

**Interfaces:**
- Consumes: interval validator/resolver from Tasks 2–3.
- Produces:
  - create request accepts optional `intervals`;
  - partial new requests require precise interval evidence;
  - full-day requests may materialize `full_day` intervals;
  - revision action creates a new interval-set revision and supersedes the previous set without deleting it;
  - approval acts on the current interval revision.

- [ ] **Step 1: Write failing API tests**

Pin:
- new 0.5-day request without intervals => 400;
- first-half request with schedule => accepted;
- custom timed request stores timezone/times;
- legacy existing request remains readable;
- revision creates revision 2 and supersedes revision 1.

- [ ] **Step 2: Run targeted tests**

Run: `npx tsx --test tests/leave-precision-api.test.ts tests/hcm-absence-wfm-integration.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement transactional interval-set creation/revision**

Write the leave header + current interval set atomically for new requests. Revision must never overwrite old interval rows.

- [ ] **Step 4: Stale overlapping timesheets on revision/approval**

Reuse `markTimesheetsStaleForEmployeeRange()`. Include stale IDs and interval revision in audit/automation evidence.

- [ ] **Step 5: Run targeted tests**

Run: `npx tsx --test tests/leave-precision-api.test.ts tests/hcm-absence-wfm-integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/leave/route.ts src/app/api/approvals/[id]/route.ts tests/leave-precision-api.test.ts tests/hcm-absence-wfm-integration.test.ts
git commit -m "feat: persist precise approved leave timing"
```

### Task 5: Use precise intervals in WFM coverage and open-shift eligibility

**Files:**
- Modify: `src/app/api/workforce/coverage/route.ts`
- Modify: `src/lib/workforce-coverage.ts`
- Modify: `src/components/workspace/workforce-coverage-panel.tsx`
- Test: `tests/workforce-coverage.test.ts`
- Test: `tests/hcm-absence-wfm-integration.test.ts`

**Interfaces:**
- Consumes: current approved interval set + resolver.
- Produces per scheduled row/shift:
  - `approvedLeaveUnavailableMinutes`;
  - `approvedLeaveFullyUnavailable`;
  - `approvedLeavePartiallyUnavailable`;
  - WFM quality findings for interval/schedule ambiguity.

- [ ] **Step 1: Write failing WFM tests**

Assert:
- 4 scheduled hours + first-half leave => only half planned capacity remains;
- split shift + leave affecting first segment leaves second segment available;
- full-day leave still removes full headcount;
- legacy ambiguous 0.5 day remains a quality issue;
- custom timed conflict blocks a full open-shift claim;
- a non-overlapping partial segment remains eligible where the product supports segment claims.

- [ ] **Step 2: Run targeted tests**

Run: `npx tsx --test tests/workforce-coverage.test.ts tests/hcm-absence-wfm-integration.test.ts`

Expected: FAIL.

- [ ] **Step 3: Integrate current precise interval evidence into coverage**

Keep scheduled headcount visible. Compute available planned minutes separately; exclude a worker from full-shift available headcount only when approved leave covers the full relevant shift.

- [ ] **Step 4: Update claim/approval rechecks**

Full-shift open-shift claims fail on any approved interval overlap. Do not add partial-shift claim UI unless an existing open-shift model can represent segment scope without schema ambiguity; otherwise return an explicit blocker and preserve future extension.

- [ ] **Step 5: Update coverage UI**

Show full/partial leave separately and expose planned unavailable hours plus any ambiguity findings.

- [ ] **Step 6: Run targeted tests**

Run: `npx tsx --test tests/workforce-coverage.test.ts tests/hcm-absence-wfm-integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/workforce/coverage/route.ts src/lib/workforce-coverage.ts src/components/workspace/workforce-coverage-panel.tsx tests/workforce-coverage.test.ts tests/hcm-absence-wfm-integration.test.ts
git commit -m "feat: apply precise leave to WFM capacity"
```

### Task 6: Add precise leave UX

**Files:**
- Modify: `src/components/workspace/panels.tsx`
- Modify as required by payload typing: `src/components/workspace/types.ts`
- Test: create `tests/leave-precision-ui.test.ts`

**Interfaces:**
- Consumes: preview endpoint from Task 3 and submission API from Task 4.
- Produces Leave UI controls: `Full day | First half | Second half | Custom hours`, schedule preview, timezone, unavailable interval summary and blocker/warning state.

- [ ] **Step 1: Write failing UI source tests**

Assert exact option labels, preview call, custom start/end inputs, timezone display and blocking state when no schedule exists for half-day.

- [ ] **Step 2: Run targeted test**

Run: `npx tsx --test tests/leave-precision-ui.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement leave form controls**

Default to Full day. For partial modes require preview success before submit. Keep existing aggregate `days` visible for payroll/balance accounting; label it clearly so interval timing is not confused with pay treatment.

- [ ] **Step 4: Update leave register display**

Show precise interval summary when present; show “Legacy timing not specified” for ambiguous old partial records.

- [ ] **Step 5: Run targeted UI test**

Run: `npx tsx --test tests/leave-precision-ui.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/panels.tsx src/components/workspace/types.ts tests/leave-precision-ui.test.ts
git commit -m "feat: add precise leave request controls"
```

### Task 7: Protect timesheets and payroll evidence

**Files:**
- Modify: `src/lib/workforce-timesheet-server.ts`
- Modify only if proven needed: `src/lib/leave-payroll.ts`, `src/lib/leave-payroll-schema.ts`
- Test: `tests/workforce-timesheet.test.ts`
- Test: `tests/hcm-absence-wfm-integration.test.ts`
- Test: existing payroll compliance test files touched only if a failing test demonstrates an integration requirement.

**Interfaces:**
- Consumes: current approved interval revision.
- Produces timesheet snapshot evidence that records precise approved leave intervals and flags actual-work overlap; payroll amounts remain owned by existing leave/payroll rules.

- [ ] **Step 1: Write failing timesheet evidence tests**

Assert:
- approved precise leave interval is snapshotted;
- recorded work overlapping leave produces a review finding, not deleted punches or automatic unpaid time;
- interval revision stales submitted/approved timesheet;
- unchanged payroll treatment remains stable.

- [ ] **Step 2: Run targeted tests**

Run: `npx tsx --test tests/workforce-timesheet.test.ts tests/hcm-absence-wfm-integration.test.ts`

Expected: FAIL for missing precise interval evidence.

- [ ] **Step 3: Add interval evidence to timesheet snapshot**

Hash/store the approved interval revision with the existing immutable attendance/schedule/OT snapshot evidence.

- [ ] **Step 4: Preserve payroll boundary**

Do not modify `leave-payroll.ts` unless an existing test requires the interval metadata for correct current behavior. Exact timing must not silently change pay in this PR.

- [ ] **Step 5: Run targeted tests**

Run: `npx tsx --test tests/workforce-timesheet.test.ts tests/hcm-absence-wfm-integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workforce-timesheet-server.ts tests/workforce-timesheet.test.ts tests/hcm-absence-wfm-integration.test.ts
git commit -m "feat: snapshot precise leave evidence in timesheets"
```

### Task 8: Full verification and merge gate

**Files:**
- Test-only changes if a full-suite failure exposes an uncovered compatibility case.

**Interfaces:**
- Produces: release evidence only.

- [ ] **Step 1: Run focused leave/WFM suite**

Run:
`npx tsx --test tests/workforce-absence.test.ts tests/workforce-absence-intervals.test.ts tests/leave-precision-api.test.ts tests/leave-precision-ui.test.ts tests/hcm-absence-wfm-integration.test.ts tests/workforce-coverage.test.ts tests/workforce-timesheet.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full repository gates**

Run:
- `npm run db:push`
- `npx tsc --noEmit`
- `npx tsx --test tests/*.test.ts`
- `npm run seo:audit`
- `npm run seo:routes`
- `npm run seo:links`
- `npx next build`

Expected: all PASS.

- [ ] **Step 3: Open PR and require hosted gates**

Require green:
- CI
- CodeQL Security
- Security HTTP Smoke
- Production Pilot Payroll QA
- Marketing Browser QA

Do not merge on a stale base; rebase/rebuild if `main` advances with schema or leave/WFM changes.

- [ ] **Step 4: Update roadmap after merge**

Update issue #194 only after merge to mark precise half-day/hourly absence timing complete and leave any unresolved break-placement limitation explicit.

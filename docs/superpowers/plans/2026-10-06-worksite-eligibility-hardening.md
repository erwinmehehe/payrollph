# Worksite Eligibility Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining approved worksite-governance gaps on top of merged PR #477 without rebuilding its core WFM integration.

**Architecture:** Extend the existing HCM worksite authorization model with explicit dated `allow|deny` decisions, make deny rules override primary/secondary allow evidence, and return structured site-eligibility findings. Surface the same evidence in the connected worker profile while preserving #477's current coverage, claim, approval, schedule-mutation, audit, MFA and timesheet-staleness paths.

**Tech Stack:** Next.js App Router, TypeScript, React 19, Drizzle ORM/PostgreSQL, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-06-worksite-eligibility-precise-absence-design.md`

## Global Constraints

- Build on merged PR #477; do not recreate its work-arrangement/worksite-eligibility stack.
- Rebase after PR #478 is merged or closed because #478 modifies `src/app/api/hcm/worker-profile/route.ts` and reserves migration `0056_hcm_employment_terms.sql`.
- Use migration `0057_hcm_worksite_authorization_decisions.sql` after #478 is integrated.
- Existing primary worksite remains payroll/location source of truth; authorization rows never silently move the worker's primary worksite.
- Explicit deny must override primary assignment and allow authorization for the same employee/worksite/date.
- Existing authorization rows migrate as `decision='allow'`; existing workers must not become newly blocked by migration alone.
- Site eligibility must not delete punches, suppress legally payable work, or mutate payroll.
- Preserve same-origin, People RBAC, org-unit scope, recent MFA, audit logging, tenant checks, effective dates and timesheet staleness already used by #477.
- No Automation Studio expansion in this plan.

## Review Focus

- A deny row overlaps a worker's primary worksite: the worker is ineligible for that site/date and receives a specific deny finding.
- Allow and deny evidence overlap: deny wins deterministically; no double counting or order-dependent behavior.
- A deny expires before the shift: later dates revert to effective primary/allow evidence.
- Cross-tenant worksite IDs or worker IDs never create/read authorization evidence.
- Connected-worker profile remains correct when PR #478 employment-term data is also present.

---

### Task 1: Add explicit authorization decisions to the data model

**Files:**
- Create: `drizzle/0057_hcm_worksite_authorization_decisions.sql`
- Modify: `drizzle/baseline.sql`
- Modify: `drizzle/README.md`
- Modify: `src/db/schema.ts`
- Test: `tests/hcm-worksite-eligibility.test.ts`

**Interfaces:**
- Consumes: existing `hcmWorksiteAuthorizations` table from #477.
- Produces: `hcmWorksiteAuthorizations.decision: "allow" | "deny"`; existing rows default to `allow`.

- [ ] **Step 1: Write failing evaluator tests for deny precedence**

Add tests asserting:
- primary site + effective deny => `eligible=false`;
- allow + effective deny => deny wins;
- expired deny + effective allow => eligible;
- legacy authorizations without explicit migrated value behave as allow.

- [ ] **Step 2: Run the targeted test**

Run: `npx tsx --test tests/hcm-worksite-eligibility.test.ts`

Expected: FAIL because authorization evidence has no `decision` field and deny precedence is unsupported.

- [ ] **Step 3: Add the migration and Drizzle field**

Add `decision varchar(8) NOT NULL DEFAULT 'allow' CHECK (decision IN ('allow','deny'))` to `hcm_worksite_authorizations`. Keep existing effective-date/index behavior and add an index covering `organization_id, employee_id, worksite_id, decision, effective_from`.

- [ ] **Step 4: Run DB/schema validation**

Run: `npm run db:push`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0057_hcm_worksite_authorization_decisions.sql drizzle/baseline.sql drizzle/README.md src/db/schema.ts tests/hcm-worksite-eligibility.test.ts
git commit -m "feat: add dated worksite authorization decisions"
```

### Task 2: Return structured worksite eligibility findings

**Files:**
- Modify: `src/lib/hcm-worksite-eligibility.ts`
- Modify: `src/lib/hcm-worksite-eligibility-server.ts`
- Test: `tests/hcm-worksite-eligibility.test.ts`

**Interfaces:**
- Consumes: authorization `decision` from Task 1.
- Produces:
  - `SiteEligibilityFinding = { code: string; severity: "warning" | "blocker"; message: string; sourceId?: number; worksiteId?: number }`
  - `SiteEligibility.findings: SiteEligibilityFinding[]`
  - compatibility `blockers: string[]` and `warnings: string[]` derived from findings for existing callers.

- [ ] **Step 1: Write failing tests for finding codes**

Assert exact codes for:
- `SITE_EXPLICITLY_DENIED`;
- `SITE_NOT_AUTHORIZED`;
- `SITE_INACTIVE`;
- `WORK_ARRANGEMENT_SITE_MISMATCH`;
- `SITE_GOVERNANCE_UNCONFIGURED`.

- [ ] **Step 2: Run targeted evaluator tests**

Run: `npx tsx --test tests/hcm-worksite-eligibility.test.ts`

Expected: FAIL because findings/codes do not exist.

- [ ] **Step 3: Implement deny-first evaluation**

Update `evaluateSiteEligibility(...): SiteEligibility` so an effective deny for the target employee/worksite/date is evaluated before primary/allow evidence. Populate structured findings and derive the existing string arrays from them.

- [ ] **Step 4: Include decision in server evidence loading**

Update `loadSiteEligibilityEvidence()` to map `decision` on authorization rows.

- [ ] **Step 5: Run targeted tests**

Run: `npx tsx --test tests/hcm-worksite-eligibility.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hcm-worksite-eligibility.ts src/lib/hcm-worksite-eligibility-server.ts tests/hcm-worksite-eligibility.test.ts
git commit -m "feat: harden worksite eligibility evidence"
```

### Task 3: Add governed site restrictions to the existing worksite API/UI

**Files:**
- Modify: `src/app/api/workforce/worksites/route.ts`
- Modify: `src/components/workspace/workforce-worksites-panel.tsx`
- Test: `tests/hcm-worksite-wfm-integration.test.ts`
- Test: `tests/workforce-worksite-api.test.ts`

**Interfaces:**
- Consumes: `decision` and structured findings from Tasks 1–2.
- Produces:
  - existing `authorize_site` action persists `decision="allow"`;
  - new `deny_site` action persists `decision="deny"`;
  - existing `end_authorization` ends either decision type.

- [ ] **Step 1: Write failing API/source tests**

Assert:
- `deny_site` requires People admin + MFA + scoped employee/site;
- authorization creation stores `allow`;
- restriction creation stores `deny`;
- cross-org site is rejected;
- end action works on allow and deny rows.

- [ ] **Step 2: Run targeted tests**

Run: `npx tsx --test tests/hcm-worksite-wfm-integration.test.ts tests/workforce-worksite-api.test.ts`

Expected: FAIL for missing deny action.

- [ ] **Step 3: Implement `deny_site` mutation**

Follow the existing #477 transaction, overlap, audit, rate-limit and timesheet-staleness patterns. Audit action/resource must distinguish authorization from restriction.

- [ ] **Step 4: Add UI control and status**

In the existing WFM worksite governance panel:
- keep “Authorize secondary site”;
- add “Restrict site”;
- render Allow/Restricted badge per effective row;
- retain “End authorization/restriction”.

- [ ] **Step 5: Run targeted tests**

Run: `npx tsx --test tests/hcm-worksite-wfm-integration.test.ts tests/workforce-worksite-api.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/workforce/worksites/route.ts src/components/workspace/workforce-worksites-panel.tsx tests/hcm-worksite-wfm-integration.test.ts tests/workforce-worksite-api.test.ts
git commit -m "feat: add governed worksite restrictions"
```

### Task 4: Surface site governance on the connected worker profile

**Files:**
- Modify: `src/app/api/hcm/worker-profile/route.ts`
- Modify: `src/components/workspace/people.tsx`
- Test: `tests/hcm-connected-worker-profile.test.ts`
- Test: `tests/hcm-worksite-wfm-integration.test.ts`

**Interfaces:**
- Consumes: #477 work arrangements and Task 1 authorization decisions.
- Produces: `connectedProfile.worksiteGovernance = { arrangement, primaryWorksite, authorizations, currentEligibilitySummary }`.

- [ ] **Step 1: Write failing worker-profile tests**

Assert the profile payload contains:
- current effective arrangement;
- primary worksite;
- effective allowed and denied sites with dates/reasons;
- no cross-tenant rows.

- [ ] **Step 2: Run targeted tests**

Run: `npx tsx --test tests/hcm-connected-worker-profile.test.ts tests/hcm-worksite-wfm-integration.test.ts`

Expected: FAIL because worksite governance is not on the worker profile.

- [ ] **Step 3: Extend the worker-profile GET**

Join/load the existing arrangement, primary assignment and authorization tables for the employee, respecting organization scope and Philippine business date.

- [ ] **Step 4: Add compact People drawer presentation**

Show “Work arrangement” and “Worksite access” underneath the existing connected worker evidence. Read-only here; mutations remain on the governed Worksites surface.

- [ ] **Step 5: Run targeted tests**

Run: `npx tsx --test tests/hcm-connected-worker-profile.test.ts tests/hcm-worksite-wfm-integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/hcm/worker-profile/route.ts src/components/workspace/people.tsx tests/hcm-connected-worker-profile.test.ts tests/hcm-worksite-wfm-integration.test.ts
git commit -m "feat: surface worksite governance on worker profiles"
```

### Task 5: Verify WFM enforcement and release gates

**Files:**
- Modify only if a failing regression proves required: `src/app/api/workforce/coverage/route.ts`, `src/app/api/workforce/schedules/route.ts`, `src/lib/workforce-coverage.ts`
- Test: `tests/workforce-coverage.test.ts`
- Test: `tests/hcm-worksite-wfm-integration.test.ts`

**Interfaces:**
- Consumes: structured evaluator from Task 2.
- Produces: no new product interface; confirms all #477 WFM enforcement points inherit deny behavior.

- [ ] **Step 1: Add regression tests**

Pin:
- denied worker remains visibly scheduled but excluded once from available coverage;
- open-shift claim rejects deny;
- manager approval recheck rejects a deny added after claim;
- schedule assignment/override rejects deny;
- actual punches/payroll evidence are not deleted.

- [ ] **Step 2: Run WFM regressions**

Run: `npx tsx --test tests/hcm-worksite-eligibility.test.ts tests/hcm-worksite-wfm-integration.test.ts tests/workforce-coverage.test.ts tests/workforce-worksite-api.test.ts`

Expected: PASS.

- [ ] **Step 3: Run full release gates**

Run:
- `npm run db:push`
- `npx tsc --noEmit`
- `npx tsx --test tests/*.test.ts`
- `npm run seo:audit`
- `npm run seo:routes`
- `npm run seo:links`
- `npx next build`

Expected: all PASS. Then require repository CI, CodeQL, Security HTTP Smoke, Production Pilot Payroll QA and Marketing Browser QA green before merge.

- [ ] **Step 4: Commit any test-only gate additions**

```bash
git add tests
git commit -m "test: prove worksite restriction enforcement"
```

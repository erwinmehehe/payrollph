# Labor-inspection POST: exact fictional PG16 HTTP proof candidate

**Scope:** `POST /api/compliance/labor-inspection` only. The existing `GET` provisional credit is unchanged. **Zero new credits. No route, schema, migration, flag or money changes.**

This draft adds a strict-refusal, localhost-only proof for the three supported actions: `assign`, `acknowledge` and `close`.

## Genuine test conditions
- Production-mode Next.js bound to `127.0.0.1:3000`; disposable empty PostgreSQL 16 `app_db`; two independent authenticated fictional employer owners and a third genuine higher-ID victim.
- Generates real `PAY_PROFILE_MISSING` findings by deleting **only fictional QA pay-profile rows**. It reads the finding from the actual GET handler, rather than inventing a key. All other payroll and user data stay synthetic.
- Submits valid owner `assign` and `acknowledge` HTTP calls. Each must create exactly one employer-bound remediation/audit receipt, while all other employers' exact payroll, employees, pay profiles, remediation and audit rows are unchanged.
- Valid higher-ID victim employer and stolen finding-key probes must deny writes. Nonexistent and real cross-bound finding keys must return identical bodies. Anonymous and revoked sessions may not obtain other-employer data.
- Injects a targeted `BEFORE INSERT` audit-event veto **inside the disposable database only**. A legitimate `acknowledge` must respond with bounded 409 and roll back *both* remediation status and audit. The synthetic trigger and function are removed immediately after the probe, also on failure.
- Tries to close an active finding, expects a refusal. Restores exactly the original fictional pay-profile record, verifies the live finding disappeared, then closes via genuine MFA-gated POST. Requires one persisted `resolved` decision and audit; replays are idempotent.

## Blockers and nonclaims
- [ ] Exact-PR-head dedicated real-HTTP PG16 proof passes, including source/denial and synthetic audit veto; **do not mark as passed before GitHub Action says success**.
- [ ] Exact-head CI, Security HTTP Smoke, CodeQL, structural and tenant inventory guards pass or every failure is triaged.
- [ ] Independent security/compliance/coverage-owner review validates all three action branches, actual DB mutations, no provider or payroll side effects, and any untested concurrent-creation/update races.
- [ ] A separate explicitly approved method-credit PR may follow. Until then `POST` stays `GAP` and `testedBy:null`.

**Not tested:** a real regulator, a real labor inspection outcome, external evidence provider, money/payroll posting, multi-entity activation, production DB, deployment, or complete tenant-wide security acceptance. These remain **NO-GO**.
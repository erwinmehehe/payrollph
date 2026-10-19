# First-payroll employer setup navigation

`PAYROLL_EMPLOYER_SETUP_NAVIGATION_ENABLED` is default-off in the critical release registry. Source merge does not activate it.

When enabled:
- An empty, successfully verified payroll employer selector explains the prerequisite and offers employer setup only when the current role already has the Enterprise page. Other operators are told to contact a company-wide owner/admin.
- Opening setup closes the modal and uses Entities in multi-entity mode, or the existing Enterprise/Legal employers view otherwise. It grants no extra API permission.
- A failed or malformed read displays an error and Retry, rather than suggesting the tenant has no employer. Reads are abortable and modal state is keyed to the selected organization. The selector endpoint remains the read-only `mode=selector` endpoint.
- Entities in legacy mode displays a useful explanation instead of blank content, with the same authorized setup destination.

No automatic employer provisioning was added. The existing legacy Enterprise administration GET still bootstraps a primary employer for authorized company-wide administrators; this change only makes that existing setup path discoverable. Payout destination, exact legal-employer confirmation, period validation, maker/checker, release and bank movement gates remain authoritative.

Verification: `npx tsx --test tests/payroll-employer-options.test.ts tests/critical-release-flags.test.ts`; `node scripts/qa/payroll-employer-setup-browser.mjs`. The browser fixture renders the actual modal and help components with intercepted fictional HTTP, at 1440 and 390 pixels. It compares flag-off modal DOM with the pinned pre-change main component, tests loading/empty/error/retry/ready/restricted states and keyboard setup navigation, and asserts zero mutations and no horizontal overflow. Artifacts live in `qa-artifacts/payroll-employer-setup` and in the synthetic browser CI artifact.

The component fixture is not authenticated API or database proof. Production activation and a completed first-payroll calculation/review remain separate work. Do not treat these navigation fixes as payroll certification.

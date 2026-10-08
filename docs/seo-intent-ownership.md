# SEO Intent Ownership

## Purpose

Every important search intent has one canonical owner. Supporting guides, calculators, glossary definitions and conversion pages may cover related language, but they must not compete for the same primary intent.

The executable source of truth is:

`src/lib/seo-intent-ownership.ts`

Run:

`npm run seo:audit`

CI runs this audit before the production build.

## Core ownership

| Primary intent | Owner |
| --- | --- |
| payroll software Philippines | / |
| HRIS Philippines | /hris |
| timekeeping system Philippines | /time-and-attendance |
| employee self service Philippines | /employee-self-service |
| payroll outsourcing Philippines | /payroll-outsourcing |
| payroll integrations Philippines | /integrations |
| payroll implementation Philippines | /implementation |
| payroll software pricing Philippines | /pricing |
| workforce analytics Philippines | /workforce-analytics |
| payroll compliance Philippines | /compliance |
| payroll software security Philippines | /security |
| payroll API Philippines | /developers |
| payroll software trial Philippines | /trial |
| payroll software demo Philippines | /book-demo |

## Intent separation rules

### Homepage vs buyer guide

The homepage owns `payroll software Philippines`.

`/resources/best-payroll-software-philippines` owns comparison/buyer-guide intent such as `best payroll software Philippines`. It should evaluate criteria and options rather than mimic the homepage.

### Guides vs calculators

An evergreen guide explains the rule or process. A calculator owns estimation/action intent.

Examples:

- `/resources/13th-month-pay-philippines` â†’ guide intent.
- `/calculators/13th-month-pay` â†’ calculator intent.
- `/resources/overtime-pay-philippines` â†’ guide intent.
- `/calculators/overtime-pay` â†’ calculator intent.

### Compliance vs glossary

A compliance page owns employer workflow and operational obligations.

A glossary entry defines terminology.

Example:

- `/compliance/withholding-tax` â†’ payroll compliance workflow.
- `/glossary/withholding-tax` â†’ definition.
- `/calculators/withholding-tax` â†’ estimate/calculation intent.

### Commercial vs industry

Industry pages qualify the commercial product for a specific operating environment. They should not try to replace the homepage for generic payroll-software intent.

Example:

- `/` â†’ payroll software Philippines.
- `/industries/bpo` â†’ BPO payroll software Philippines.

## Audit failure conditions

The launch audit fails when it finds:

- duplicate primary/supporting intent ownership,
- duplicate owner paths,
- an owner path missing from public sitemap data,
- a private/auth/app path assigned an SEO intent,
- duplicate public sitemap URLs,
- duplicate dynamic authority-page metadata titles,
- duplicate glossary slugs,
- authority related links pointing to private or non-discoverable routes.

## Adding a new SEO page

Before creating a new indexable route:

1. Check the ownership registry for the intended query.
2. Decide whether the new page is commercial, compliance, industry, guide, calculator, glossary, trust, developer or conversion intent.
3. Add one primary intent owner only.
4. Keep adjacent pages differentiated by user task.
5. Add the route to the correct sitemap segment.
6. Add contextual internal links.
7. Run `npm run seo:audit`.
8. Run the full CI suite before merge.


## BOFU decision-guide ownership

| Primary intent | Owner |
| --- | --- |
| HRIS vs payroll system Philippines | /resources/hris-vs-payroll-system |
| payroll system comparison Philippines | /resources/payroll-system-comparison |
| payroll outsourcing cost Philippines | /resources/payroll-outsourcing-cost |
| how payroll outsourcing works Philippines | /resources/payroll-outsourcing-guide |

These pages intentionally do not own the broader commercial queries:

- `HRIS Philippines` remains owned by `/hris`.
- `payroll outsourcing Philippines` remains owned by `/payroll-outsourcing`.
- `best payroll software Philippines` remains owned by `/resources/best-payroll-software-philippines`.


## Employee-loan and retro-pay ownership

| Primary intent | Owner |
| --- | --- |
| employee loans payroll Philippines | /resources/employee-loans-payroll |
| retroactive pay Philippines | /resources/retroactive-pay |

Manual-payroll comparison intent is deliberately consolidated into the existing Excel comparison page:

- `/resources/payroll-software-vs-excel` owns `manual payroll vs software Philippines` and related spreadsheet/manual-payroll comparison queries.
- Do not create a separate `/resources/manual-payroll-vs-software` page unless search intent later proves meaningfully different.

The employee-loan page owns payroll deduction/ledger process intent. It does not determine external lender eligibility or loan approval.

The retroactive-pay page owns payroll correction mechanics for effective-dated pay changes. It does not determine universal legal entitlement to retroactive compensation.


## Competitor-alternative ownership

| Primary intent | Owner |
| --- | --- |
| Sprout Payroll alternative Philippines | /resources/sprout-payroll-alternative |

The competitor-alternative page owns branded comparison intent only.

It must not replace or compete with:
- `payroll software Philippines` â†’ `/`
- `best payroll software Philippines` â†’ `/resources/best-payroll-software-philippines`
- `payroll system comparison Philippines` â†’ `/resources/payroll-system-comparison`

Competitor pages must use current public evidence, link the source material, state the review date and avoid unsupported superiority, security, compliance, pricing or product-defect claims.


## Landing-page copy alignment - October 2026

The category language below is a qualitative intent hypothesis, not a search-volume or ranking estimate. Existing canonical ownership remains unchanged.

| Page | Buyer question the copy answers |
| --- | --- |
| Homepage | Can employee records, time and Philippine payroll work together? |
| Small-business payroll | How do we move from spreadsheets to a controlled cutoff? |
| HRIS | How do we maintain and import accurate employee records? |
| HCM | Who owns onboarding, employment changes and compensation decisions? |
| Workforce Management | Can qualified employees cover the planned shifts? |
| Time & Attendance | How do we resolve recorded-time exceptions before payroll? |
| Employee Self-Service | Can employees access their own released payslips and pay history? |
| Workforce Analytics | What changed in headcount or payroll, and can we trace it? |
| Outsourcing | What does the service handle, and what remains with our team? |
| Pricing | What plan, cost and scope should we evaluate? |
| Implementation | How do we reconcile data and prepare the first cutoff? |
| Trust / About | What evidence and product identity can a buying team verify? |
| Contact / Book Demo | Do we have a general question or need a workflow walkthrough? |

Product-related links lead to the detailed payroll workflow rather than sending every visitor back to the homepage. Category names appear in titles and introductory copy; outcome-led H1s are preserved. The outsourcing H1 remains Payroll Outsourcing Philippines.

Research references:

- [Google Search Central: helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content): descriptive headings, useful content and accurate claims guide the copy approach.
- [ADP Philippines: time and attendance](https://ph.adp.com/what-we-offer/products/adp-securtime/solution.aspx): a primary vendor reference for the time-and-attendance category, separate from broader staffing planning.
- [Parfait Philippines](https://www.parfait.com.ph/): search-result category wording includes payroll and HRIS. This is vocabulary context, not evidence of demand or Linaw capability.

Validate these hypotheses after publication with Search Console query/page data and qualified demo requests. Do not change canonical URLs merely to insert more keywords.

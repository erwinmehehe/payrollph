# SEO Publishing SOP

## Purpose

This SOP keeps Linaw / PayrollPH public content aligned with search intent, product evidence and current Philippine payroll sources.

## Before creating a URL

1. Define the primary search intent and confirm an existing page does not already own it.
2. Prefer an evergreen URL for durable concepts.
3. Use a dated regulatory-update URL only when the value is the specific change, advisory or announcement.
4. Do not create yearly versions of evergreen guides solely to appear fresh.
5. Identify the conversion path and at least three useful internal links.

## Product claims

- Verify the capability against the repository or an approved operational source.
- Distinguish implemented, partial, external dependency and absent states.
- Do not turn an export into a “native integration.”
- Do not claim government filing acceptance from a calculation or generated file alone.
- Do not claim ISO, SOC or other certification without current evidence.

## Payroll, tax and labor content

- Prefer official Philippine sources: BIR, DOLE/NWPC, SSS, PhilHealth, Pag-IBIG and other issuing agencies.
- Record the publication/effective date when a rule is time-sensitive.
- Add a visible last-reviewed date to high-risk guides.
- Link the official source from the page.
- Use plain-English explanations and state material limitations.
- Avoid universal legal conclusions when eligibility depends on facts.

## Calculators

- Reuse product calculation helpers when an appropriate tested helper already exists.
- If the correct basis varies by employee or employer policy, require the user to enter that basis.
- Do not build a calculator that implies legal entitlement when entitlement requires factual/legal review.
- Display an estimate disclaimer.

## Metadata

- Give each commercial or authority page one clear intent owner.
- Use a page-specific title rather than an internal category label.
- Keep titles descriptive rather than stuffed with near-duplicate keywords.
- Write a unique meta description that explains what the visitor will get.

## Structured data

Use only schema supported by visible content:
- Article for guides/updates.
- WebApplication for calculators.
- Service for industry/service pages.
- DefinedTerm for glossary entries.
- BreadcrumbList for hierarchy.
- FAQPage only when the questions and answers are visible.
- Never add fabricated AggregateRating, Review or award data.

## Internal linking

Every authority page should link naturally toward:
1. the closest supporting guide or calculator,
2. the relevant product/compliance page,
3. a conversion or proof surface where appropriate.

Avoid mechanically forcing the same anchor text onto every page.

## Regulatory updates

A dated update must contain:
- issuing agency,
- publication date,
- official source,
- concise description of the change,
- affected payroll workflows,
- links to the evergreen canonical guides.

Historical updates remain available for rule-history context.

## QA before merge

- Run repository CI and SEO regression tests.
- Confirm canonical URL and indexability.
- Confirm sitemap inclusion for indexable pages.
- Confirm auth/app routes remain noindex or excluded where appropriate.
- Verify no unsupported compliance, certification, customer or integration claims were introduced.

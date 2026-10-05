# SEO Conversion Measurement

## Purpose

Linaw records first-party marketing attribution with demo and trial requests so SEO performance can be connected to actual lead actions without requiring a third-party analytics cookie.

## Captured fields

The browser session records the first page seen during the session plus standard UTM values:

- landing path
- referrer origin + path
- UTM source
- UTM medium
- UTM campaign
- UTM content
- UTM term

At conversion time the form also records:

- conversion path
- request type: demo or trial

## Privacy boundaries

- Attribution uses sessionStorage, not cookies.
- It is first-touch for the current browser session only.
- Referrer query strings and fragments are not stored.
- Arbitrary landing-page query parameters are not stored.
- Employee or payroll data is not part of attribution.
- The server sanitizes all attribution fields again before recording them.

## Where the data goes

Attribution is appended to the existing demo-request outbox message. No new analytics table is introduced by this feature.

This keeps lead attribution available to the operator even when no external analytics provider is configured.

## Recommended reporting

Combine three data sources:

1. Google Search Console for query, landing-page, impression, click and position data.
2. Demo/trial request attribution for first-party lead source and landing-page context.
3. CRM or sales outcome data, when available, for qualified lead and customer status.

Useful monthly SEO conversion cuts include:

- leads by first landing page
- leads by UTM source / medium
- demo vs trial requests
- non-branded landing pages that generated requests
- compliance/resources/calculator pages that assisted conversion
- qualified leads by landing-page family

## GA4 / external analytics

External analytics can be added later as a complementary behavioral layer. It should not replace first-party lead attribution, and tracking IDs should remain deployment configuration rather than committed source values.


## Aggregate reporting endpoint

When `MARKETING_REPORT_EMAILS` is configured, an authenticated allowlisted user with a recently MFA-verified session can request:

`GET /api/marketing/leads?days=90`

The endpoint returns aggregates only:

- total requests
- attributed vs unattributed requests
- demo vs trial counts
- landing-page counts
- source / medium counts
- campaign counts
- headcount buckets
- daily request counts

It deliberately does not return:

- contact names
- email addresses
- company names
- free-text notes
- message bodies

Leave `MARKETING_REPORT_EMAILS` empty to disable the report completely.

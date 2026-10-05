# Search Console & Indexation Launch Checklist

## Ownership

Configure deployment environment variables when available:
- GOOGLE_SITE_VERIFICATION
- BING_SITE_VERIFICATION

The application emits verification metadata only when a value is configured. Never commit verification tokens to the repository.

## Google Search Console

1. Add the canonical production property.
2. Complete ownership verification.
3. Submit `/sitemap.xml`. It is the sitemap index and points to segmented product, compliance, industry, resource, calculator, glossary and developer sitemaps.
4. Inspect the homepage and highest-priority commercial URLs.
5. Request indexing only after production content, canonical and robots behavior are correct.
6. Recheck indexing after major route launches.

## Priority URL groups

- Homepage / payroll software
- HRIS
- Time & attendance
- Payroll outsourcing
- Pricing
- Compliance hub and government guides
- Industry pages
- Calculators
- Buyer resources
- Trust/security/developer pages

## Weekly review during launch

Track:
- indexed vs submitted pages,
- crawl errors,
- canonical selection,
- excluded/noindex pages,
- organic clicks,
- impressions,
- CTR,
- average position,
- non-branded query growth,
- new landing pages receiving impressions.

## Cannibalization review

Investigate when multiple Linaw pages repeatedly appear for the same high-value query:
- payroll software Philippines → homepage
- HRIS Philippines → /hris
- payroll outsourcing Philippines → /payroll-outsourcing
- timekeeping system Philippines → /time-and-attendance

Do not solve cannibalization by deleting useful pages without first checking query intent and internal linking.

## Regulatory content monitoring

For high-risk compliance pages:
- review government sources when an agency issues a new circular/advisory,
- publish a dated update when the change itself has search value,
- update the evergreen guide when the current rule changes,
- update Last reviewed after a real review, not automatically.

## Release gate

Before considering a new SEO wave complete:
- CI green
- browser QA green
- security smoke green
- CodeQL green where configured
- production deployment healthy
- sitemap index accessible
- segmented child sitemaps return XML successfully
- robots accessible
- canonical host correct
- no auth/app routes accidentally indexed

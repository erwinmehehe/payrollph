# Linaw marketing redesign — review notes (2026-10-07)

## Scope
- Homepage: Gusto/Attio-inspired light visual system; four product/service cards and detailed payroll, WFM, HCM, outsourcing and Philippine statutory workflow sections.
- Dedicated workforce-management and HCM landing pages, without replacing canonical HRIS/time-and-attendance pages.
- Align existing outsourcing service page while retaining its live quotation form and employer approval boundary.
- Keep persisted pricing, real demo route, role-based workflow, security explanation, FAQ, footer, and pricing calculator.
- Keep the product/feature claims scoped to code-supported workflows or mark readiness dependencies.

## Truth-in-marketing guardrails
- No customer logos, customer names, testimonials, star ratings, customer counts, SLA promises, compliance guarantees, or synthetic success statistics.
- All static example payroll and WFM/HCM panels explicitly say illustrative/sample; avoid implying they are real transactions or screenshots of deployed production.
- Government calculations are not certification, actual remittance, or formal agency filing acceptance.
- Outsourcing does not transfer employer decision or statutory responsibility.
- Avoid replacing form endpoints or application/production payroll logic.

## Pre-merge evidence
- npm run lint
- npm run build
- Existing production/marketing browser QA including nav and CTA checks
- 390px, 768px and 1440px viewport screenshots for homepage and three solution pages
- Keyboard/tab order and anchor links, internal route checks, contrast and responsive review
- No deployment/merge without approval.

import { absolutePublicUrl, PUBLIC_SITE_URL } from "@/lib/site-url";

export const dynamic = "force-static";

export function GET() {
  const body = `# Linaw

> Philippine payroll software with HR, timekeeping, statutory payroll calculations, approvals, employee self-service, integrations and multi-client workflows.

Canonical site: ${PUBLIC_SITE_URL}

## Primary pages
- Payroll software: ${absolutePublicUrl("/")}
- HRIS: ${absolutePublicUrl("/hris")}
- Time and attendance: ${absolutePublicUrl("/time-and-attendance")}
- Employee self-service: ${absolutePublicUrl("/employee-self-service")}
- Payroll outsourcing: ${absolutePublicUrl("/payroll-outsourcing")}
- Pricing: ${absolutePublicUrl("/pricing")}

## Compliance and payroll knowledge
- Compliance center: ${absolutePublicUrl("/compliance")}
- Payroll guides: ${absolutePublicUrl("/resources")}
- Regulatory updates: ${absolutePublicUrl("/resources/updates")}
- Payroll glossary: ${absolutePublicUrl("/glossary")}
- Payroll calculators: ${absolutePublicUrl("/calculators")}

## Product evidence and technical documentation
- Trust center: ${absolutePublicUrl("/trust")}
- Security: ${absolutePublicUrl("/security")}
- Capability scorecard: ${absolutePublicUrl("/scorecard")}
- Integrations: ${absolutePublicUrl("/integrations")}
- Developer center: ${absolutePublicUrl("/developers")}
- Evidence methodology: ${absolutePublicUrl("/methodology")}

## Important interpretation notes
- Payroll calculation capability is not the same as government filing acceptance.
- Government outputs may remain validation-gated until external acceptance evidence exists.
- Public calculators are educational or planning estimates, not legal or tax advice.
- Security pages describe implemented controls and do not imply certifications that have not been independently obtained.
- Customer outcomes should not be treated as verified unless they appear in an approved customer story with evidence.

## Discovery
- XML sitemap: ${absolutePublicUrl("/sitemap.xml")}
- Regulatory RSS feed: ${absolutePublicUrl("/resources/updates/feed.xml")}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

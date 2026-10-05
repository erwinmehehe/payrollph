export type DynamicSeoRouteContract = {
  name: string;
  routePattern: string;
  pageFile: string;
  canonicalSignal: string;
  schemaSignal: string;
  additionalSignals?: string[];
  allowConditionalNoindex?: boolean;
};

export const DYNAMIC_SEO_ROUTE_CONTRACTS: DynamicSeoRouteContract[] = [
  {
    name: "resource guides",
    routePattern: "/resources/[slug]",
    pageFile: "src/app/resources/[slug]/page.tsx",
    canonicalSignal: 'alternates: { canonical: `/resources/${slug}` }',
    schemaSignal: "article={{",
  },
  {
    name: "compliance guides",
    routePattern: "/compliance/[slug]",
    pageFile: "src/app/compliance/[slug]/page.tsx",
    canonicalSignal: 'alternates: { canonical: `/compliance/${slug}` }',
    schemaSignal: "article={{",
  },
  {
    name: "industry pages",
    routePattern: "/industries/[slug]",
    pageFile: "src/app/industries/[slug]/page.tsx",
    canonicalSignal: 'alternates: { canonical: `/industries/${slug}` }',
    schemaSignal: "service={{",
  },
  {
    name: "integration pages",
    routePattern: "/integrations/[slug]",
    pageFile: "src/app/integrations/[slug]/page.tsx",
    canonicalSignal: 'alternates: { canonical: `/integrations/${slug}` }',
    schemaSignal: "service={{",
  },
  {
    name: "payroll calculators",
    routePattern: "/calculators/[slug]",
    pageFile: "src/app/calculators/[slug]/page.tsx",
    canonicalSignal: 'alternates: { canonical: `/calculators/${slug}` }',
    schemaSignal: "webApplication={{",
    additionalSignals: ["faq={guide.faq}"],
  },
  {
    name: "payroll glossary",
    routePattern: "/glossary/[slug]",
    pageFile: "src/app/glossary/[slug]/page.tsx",
    canonicalSignal: 'alternates: { canonical: `/glossary/${slug}` }',
    schemaSignal: "definedTerm={{",
  },
  {
    name: "regulatory updates",
    routePattern: "/resources/updates/[slug]",
    pageFile: "src/app/resources/updates/[slug]/page.tsx",
    canonicalSignal: 'alternates: { canonical: `/resources/updates/${slug}` }',
    schemaSignal: "article={{",
    additionalSignals: ["datePublished:", "dateModified:"],
  },
  {
    name: "developer documentation",
    routePattern: "/developers/[slug]",
    pageFile: "src/app/developers/[slug]/page.tsx",
    canonicalSignal: 'alternates: { canonical: `/developers/${slug}` }',
    schemaSignal: "article={{",
  },
  {
    name: "customer stories",
    routePattern: "/customers/[slug]",
    pageFile: "src/app/customers/[slug]/page.tsx",
    canonicalSignal: 'alternates: { canonical: `/customers/${slug}` }',
    schemaSignal: "article={{",
    additionalSignals: [
      "PUBLISHABLE_CUSTOMER_STORIES",
      "robots: { index: true, follow: true }",
      "if (!story) notFound()",
    ],
    allowConditionalNoindex: true,
  },
];

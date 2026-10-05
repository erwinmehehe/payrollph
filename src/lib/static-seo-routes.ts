export type StaticSeoRoute = {
  path: string;
  pageFile: string;
};

export const STATIC_SEO_ROUTES: StaticSeoRoute[] = [
  { path: "/", pageFile: "src/app/page.tsx" },
  { path: "/about", pageFile: "src/app/about/page.tsx" },
  { path: "/contact", pageFile: "src/app/contact/page.tsx" },
  { path: "/trust", pageFile: "src/app/trust/page.tsx" },
  { path: "/security", pageFile: "src/app/security/page.tsx" },
  { path: "/status", pageFile: "src/app/status/page.tsx" },
  { path: "/methodology", pageFile: "src/app/methodology/page.tsx" },
  { path: "/scorecard", pageFile: "src/app/scorecard/page.tsx" },
  { path: "/compare", pageFile: "src/app/compare/page.tsx" },
  { path: "/templates/payroll-rfp-checklist", pageFile: "src/app/templates/payroll-rfp-checklist/page.tsx" },
  { path: "/templates/payroll-security-checklist", pageFile: "src/app/templates/payroll-security-checklist/page.tsx" },
  { path: "/demo", pageFile: "src/app/demo/page.tsx" },
  { path: "/book-demo", pageFile: "src/app/book-demo/page.tsx" },
  { path: "/trial", pageFile: "src/app/trial/page.tsx" },
  { path: "/hris", pageFile: "src/app/hris/page.tsx" },
  { path: "/time-and-attendance", pageFile: "src/app/time-and-attendance/page.tsx" },
  { path: "/employee-self-service", pageFile: "src/app/employee-self-service/page.tsx" },
  { path: "/integrations", pageFile: "src/app/integrations/page.tsx" },
  { path: "/implementation", pageFile: "src/app/implementation/page.tsx" },
  { path: "/pricing", pageFile: "src/app/pricing/page.tsx" },
  { path: "/small-business-payroll", pageFile: "src/app/small-business-payroll/page.tsx" },
  { path: "/payroll-outsourcing", pageFile: "src/app/payroll-outsourcing/page.tsx" },
  { path: "/payroll-health-check", pageFile: "src/app/payroll-health-check/page.tsx" },
  { path: "/workforce-analytics", pageFile: "src/app/workforce-analytics/page.tsx" },
  { path: "/compliance", pageFile: "src/app/compliance/page.tsx" },
  { path: "/industries", pageFile: "src/app/industries/page.tsx" },
  { path: "/resources", pageFile: "src/app/resources/page.tsx" },
  { path: "/calculators", pageFile: "src/app/calculators/page.tsx" },
  { path: "/glossary", pageFile: "src/app/glossary/page.tsx" },
  { path: "/developers", pageFile: "src/app/developers/page.tsx" },
];

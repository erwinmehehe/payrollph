export type PublicLink = {
  label: string;
  href: string;
};

export const PUBLIC_PRIMARY_LINKS: PublicLink[] = [
  { label: "Product", href: "/#product" },
  { label: "Live demo", href: "/demo" },
  { label: "Pricing", href: "/pricing" },
  { label: "Payroll outsourcing", href: "/payroll-outsourcing" },
  { label: "Trust", href: "/trust" },
];

export const PUBLIC_FOOTER_GROUPS: Array<{ label: string; links: PublicLink[] }> = [
  {
    label: "Product",
    links: [
      { label: "Product overview", href: "/#product" },
      { label: "HRIS", href: "/hris" },
      { label: "Time & attendance", href: "/time-and-attendance" },
      { label: "Employee self-service", href: "/employee-self-service" },
      { label: "Integrations", href: "/integrations" },
      { label: "Workforce analytics", href: "/workforce-analytics" },
      { label: "Developer center", href: "/developers" },
      { label: "Pricing", href: "/pricing" },
      { label: "Small business payroll", href: "/small-business-payroll" },
      { label: "Payroll outsourcing", href: "/payroll-outsourcing" },
    ],
  },
  {
    label: "Resources",
    links: [
      { label: "Payroll guides", href: "/resources" },
      { label: "Payroll calculators", href: "/calculators" },
      { label: "Payroll glossary", href: "/glossary" },
      { label: "Regulatory updates", href: "/resources/updates" },
      { label: "Payroll compliance", href: "/compliance" },
      { label: "Implementation & migration", href: "/implementation" },
      { label: "Industries", href: "/industries" },
      { label: "Payroll health check", href: "/payroll-health-check" },
      { label: "Payroll comparisons", href: "/compare" },
      { label: "RFP checklist", href: "/templates/payroll-rfp-checklist" },
      { label: "Security checklist", href: "/templates/payroll-security-checklist" },
    ],
  },
  {
    label: "Trust & access",
    links: [
      { label: "About Linaw", href: "/about" },
      { label: "Contact Linaw", href: "/contact" },
      { label: "Trust center", href: "/trust" },
      { label: "Capability scorecard", href: "/scorecard" },
      { label: "Security", href: "/security" },
      { label: "System status", href: "/status" },
      { label: "Evidence methodology", href: "/methodology" },
      { label: "Request trial access", href: "/trial" },
      { label: "Book a demo", href: "/book-demo" },
      { label: "Sign in", href: "/login" },
    ],
  },
];

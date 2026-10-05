export type PublicLink = {
  label: string;
  href: string;
};

export const PUBLIC_PRIMARY_LINKS: PublicLink[] = [
  { label: "Product", href: "/#product" },
  { label: "Resources", href: "/resources" },
  { label: "Compliance", href: "/compliance" },
  { label: "Live demo", href: "/demo" },
  { label: "Payroll outsourcing", href: "/payroll-outsourcing" },
  { label: "Trust", href: "/scorecard" },
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
      { label: "Developer center", href: "/developers" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    label: "Solutions",
    links: [
      { label: "Payroll outsourcing", href: "/payroll-outsourcing" },
      { label: "Payroll compliance", href: "/compliance" },
      { label: "Implementation & migration", href: "/implementation" },
      { label: "Industries", href: "/industries" },
      { label: "Payroll health check", href: "/payroll-health-check" },
    ],
  },
  {
    label: "Resources",
    links: [
      { label: "Payroll guides", href: "/resources" },
      { label: "Payroll calculators", href: "/calculators" },
      { label: "BIR payroll guide", href: "/compliance/bir" },
      { label: "SSS payroll guide", href: "/compliance/sss" },
      { label: "PhilHealth payroll guide", href: "/compliance/philhealth" },
      { label: "Pag-IBIG payroll guide", href: "/compliance/pag-ibig" },
    ],
  },
  {
    label: "Trust",
    links: [
      { label: "Trust center", href: "/trust" },
      { label: "Capability scorecard", href: "/scorecard" },
      { label: "Security", href: "/security" },
      { label: "System status", href: "/status" },
      { label: "Book a demo", href: "/book-demo" },
    ],
  },
  {
    label: "Get started",
    links: [
      { label: "Request trial access", href: "/signup" },
      { label: "Book a demo", href: "/book-demo" },
      { label: "Sign in", href: "/login" },
    ],
  },
];

export type PublicLink = {
  label: string;
  href: string;
};

export const PUBLIC_PRIMARY_LINKS: PublicLink[] = [
  { label: "Product", href: "/#product" },
  { label: "Live demo", href: "/demo" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Payroll outsourcing", href: "/payroll-outsourcing" },
  { label: "Trust", href: "/trust" },
];

export const PUBLIC_FOOTER_GROUPS: Array<{ label: string; links: PublicLink[] }> = [
  {
    label: "Product",
    links: [
      { label: "Product overview", href: "/#product" },
      { label: "Role-based demo", href: "/demo" },
      { label: "Payroll outsourcing", href: "/payroll-outsourcing" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    label: "Company",
    links: [
      { label: "Trust Center", href: "/trust" },\n      { label: "Capability scorecard", href: "/scorecard" },
      { label: "Security", href: "/#security" },
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

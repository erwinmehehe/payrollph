export type PublicLink = {
  label: string;
  href: string;
};

export const PUBLIC_PRIMARY_LINKS: PublicLink[] = [
  { label: "Product", href: "/#product" },
  { label: "Role demo", href: "/demo" },
  { label: "Calculator", href: "/#calculator" },
  { label: "Security", href: "/#security" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Outsourcing", href: "/payroll-outsourcing" },
];

export const PUBLIC_FOOTER_GROUPS: Array<{ label: string; links: PublicLink[] }> = [
  {
    label: "Product",
    links: [
      { label: "How it works", href: "/#product" },
      { label: "Role-based demo", href: "/demo" },
      { label: "Payroll simulation", href: "/#demo" },
      { label: "Payroll calculator", href: "/#calculator" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Payroll outsourcing", href: "/payroll-outsourcing" },
    ],
  },
  {
    label: "Trust",
    links: [
      { label: "Security", href: "/#security" },
      { label: "Capability scorecard", href: "/#scorecard" },
      { label: "API & developer", href: "/#developers" },
      { label: "System status", href: "/status" },
    ],
  },
  {
    label: "Get started",
    links: [
      { label: "Start free", href: "/signup" },
      { label: "Book a demo", href: "/book-demo" },
      { label: "Sign in", href: "/login" },
    ],
  },
];

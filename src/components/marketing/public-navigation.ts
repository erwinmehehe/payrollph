export type PublicLink = { label: string; href: string };

export const PUBLIC_PRIMARY_LINKS: PublicLink[] = [
  { label: "Payroll", href: "/#payroll" },
  { label: "Workforce Management", href: "/workforce-management" },
  { label: "HCM", href: "/hcm" },
  { label: "Outsourcing", href: "/payroll-outsourcing" },
  { label: "Pricing", href: "/pricing" },
];

export const PUBLIC_FOOTER_GROUPS: Array<{ label: string; links: PublicLink[] }> = [
  {label:"Products",links:[
    {label:"Payroll software",href:"/#payroll"},
    {label:"Workforce management",href:"/workforce-management"},
    {label:"Human capital management",href:"/hcm"},
    {label:"HRIS",href:"/hris"},
    {label:"Time & attendance",href:"/time-and-attendance"},
    {label:"Employee self-service",href:"/employee-self-service"},
    {label:"Workforce analytics",href:"/workforce-analytics"},
    {label:"Integrations",href:"/integrations"},
    {label:"Pricing",href:"/pricing"},
  ]},
  {label:"Services & resources",links:[
    {label:"Payroll outsourcing",href:"/payroll-outsourcing"},
    {label:"Implementation",href:"/implementation"},
    {label:"Payroll calculators",href:"/calculators"},
    {label:"Payroll guides",href:"/resources"},
    {label:"Philippine compliance",href:"/compliance"},
    {label:"Payroll health check",href:"/payroll-health-check"},
    {label:"Industries",href:"/industries"},
    {label:"Developer center",href:"/developers"},
  ]},
  {label:"Company & trust",links:[
    {label:"About Linaw",href:"/about"},
    {label:"Contact",href:"/contact"},
    {label:"Trust center",href:"/trust"},
    {label:"Security",href:"/security"},
    {label:"Evidence methodology",href:"/methodology"},
    {label:"Capability scorecard",href:"/scorecard"},
    {label:"Request a demo",href:"/book-demo"},
    {label:"Sign in",href:"/login"},
  ]},
];

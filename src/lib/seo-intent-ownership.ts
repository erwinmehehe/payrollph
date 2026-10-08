export type SeoIntentOwner = {
  primaryIntent: string;
  ownerPath: string;
  intentClass: "commercial" | "compliance" | "industry" | "guide" | "calculator" | "glossary" | "trust" | "developer" | "conversion";
  supportingIntents?: string[];
  note?: string;
};

export const SEO_PRIVATE_ROUTE_PREFIXES = [
  "/api",
  "/app",
  "/workspace",
  "/login",
  "/signup",
  "/setup",
  "/invite",
  "/reset-password",
  "/verify-email",
] as const;

export const SEO_INTENT_OWNERS: SeoIntentOwner[] = [
  { primaryIntent: "hcm philippines", ownerPath: "/hcm", intentClass: "commercial", supportingIntents: ["human capital management philippines", "hcm software philippines"] },
  { primaryIntent: "workforce management philippines", ownerPath: "/workforce-management", intentClass: "commercial", supportingIntents: ["workforce scheduling philippines", "workforce management software philippines"] },
  {
    primaryIntent: "about linaw payrollph",
    ownerPath: "/about",
    intentClass: "trust",
    supportingIntents: ["about linaw", "about payrollph"],
    note: "Own branded company/product identity intent only; do not broaden into generic payroll software intent.",
  },
  {
    primaryIntent: "contact linaw payrollph",
    ownerPath: "/contact",
    intentClass: "conversion",
    supportingIntents: ["contact linaw", "contact payrollph"],
    note: "Own branded contact-navigation intent only; do not broaden into generic payroll software or support claims.",
  },
  {
    primaryIntent: "payroll software philippines",
    ownerPath: "/",
    intentClass: "commercial",
    supportingIntents: ["payroll system philippines", "cloud payroll philippines", "philippine payroll software", "payroll management system philippines"],
  },
  {
    primaryIntent: "hris philippines",
    ownerPath: "/hris",
    intentClass: "commercial",
    supportingIntents: ["hris software philippines", "human resource information system philippines", "hr software philippines"],
  },
  {
    primaryIntent: "timekeeping system philippines",
    ownerPath: "/time-and-attendance",
    intentClass: "commercial",
    supportingIntents: ["time and attendance system philippines", "attendance software philippines", "employee timekeeping system philippines"],
  },
  {
    primaryIntent: "employee self service philippines",
    ownerPath: "/employee-self-service",
    intentClass: "commercial",
    supportingIntents: ["ess philippines", "employee self service software philippines", "employee self service portal philippines"],
  },
  {
    primaryIntent: "payroll outsourcing philippines",
    ownerPath: "/payroll-outsourcing",
    intentClass: "commercial",
    supportingIntents: ["payroll services philippines", "outsourced payroll philippines", "payroll processing services philippines"],
  },
  {
    primaryIntent: "payroll integrations philippines",
    ownerPath: "/integrations",
    intentClass: "commercial",
    supportingIntents: ["payroll system integration philippines", "hris payroll integration philippines"],
  },
  {
    primaryIntent: "biometric payroll integration philippines",
    ownerPath: "/integrations/biometrics",
    intentClass: "commercial",
  },
  {
    primaryIntent: "payroll accounting export philippines",
    ownerPath: "/integrations/accounting-exports",
    intentClass: "commercial",
    supportingIntents: ["payroll accounting integration philippines"],
    note: "Own file-export intent. Do not broaden this into unsupported native accounting-platform integrations.",
  },
  {
    primaryIntent: "payroll bank file philippines",
    ownerPath: "/integrations/bank-payout-exports",
    intentClass: "commercial",
    supportingIntents: ["payroll bank file export philippines", "payroll payout file philippines"],
  },
  {
    primaryIntent: "payroll system implementation philippines",
    ownerPath: "/implementation",
    intentClass: "commercial",
    supportingIntents: ["payroll implementation philippines", "payroll migration philippines"],
  },
  {
    primaryIntent: "payroll software pricing philippines",
    ownerPath: "/pricing",
    intentClass: "commercial",
    supportingIntents: ["payroll software price philippines", "payroll system cost philippines"],
  },
  {
    primaryIntent: "small business payroll software philippines",
    ownerPath: "/small-business-payroll",
    intentClass: "commercial",
    supportingIntents: [
      "sme payroll software philippines",
      "payroll system for small business philippines",
      "small business payroll system philippines"
    ],
    note: "Own SME/small-business solution intent. The homepage remains the broad payroll software Philippines owner.",
  },
  {
    primaryIntent: "workforce analytics philippines",
    ownerPath: "/workforce-analytics",
    intentClass: "commercial",
    supportingIntents: ["payroll analytics philippines", "payroll reporting philippines", "workforce reporting philippines"],
    note: "Own operational reporting intent. Do not imply predictive AI or external benchmarking.",
  },
  {
    primaryIntent: "payroll software security philippines",
    ownerPath: "/security",
    intentClass: "trust",
    supportingIntents: ["payroll data security philippines"],
  },
  {
    primaryIntent: "payroll software trust center",
    ownerPath: "/trust",
    intentClass: "trust",
  },
  {
    primaryIntent: "linaw system status",
    ownerPath: "/status",
    intentClass: "trust",
    supportingIntents: ["linaw status", "payrollph status"],
    note: "Own branded operational-status intent only; do not broaden into generic uptime claims.",
  },
  {
    primaryIntent: "payroll api philippines",
    ownerPath: "/developers",
    intentClass: "developer",
    supportingIntents: ["payroll api documentation philippines"],
  },
  { primaryIntent: "payroll api authentication documentation", ownerPath: "/developers/authentication", intentClass: "developer" },
  { primaryIntent: "payroll employee api documentation", ownerPath: "/developers/employees", intentClass: "developer" },
  { primaryIntent: "payroll runs api documentation", ownerPath: "/developers/payroll-runs", intentClass: "developer" },
  { primaryIntent: "payroll webhook documentation", ownerPath: "/developers/webhooks", intentClass: "developer" },
  {
    primaryIntent: "payroll compliance philippines",
    ownerPath: "/compliance",
    intentClass: "compliance",
    supportingIntents: ["philippine payroll compliance", "statutory payroll philippines"],
  },
  { primaryIntent: "bir payroll compliance", ownerPath: "/compliance/bir", intentClass: "compliance" },
  { primaryIntent: "sss payroll compliance", ownerPath: "/compliance/sss", intentClass: "compliance" },
  { primaryIntent: "philhealth payroll compliance", ownerPath: "/compliance/philhealth", intentClass: "compliance" },
  { primaryIntent: "pag-ibig payroll compliance", ownerPath: "/compliance/pag-ibig", intentClass: "compliance" },
  { primaryIntent: "dole payroll compliance", ownerPath: "/compliance/dole", intentClass: "compliance" },
  { primaryIntent: "bir form 2316 payroll", ownerPath: "/compliance/bir-2316", intentClass: "compliance" },
  { primaryIntent: "bir 1601-c payroll", ownerPath: "/compliance/1601-c", intentClass: "compliance" },
  { primaryIntent: "payroll alphalist philippines", ownerPath: "/compliance/alphalist", intentClass: "compliance" },
  { primaryIntent: "withholding tax payroll compliance", ownerPath: "/compliance/withholding-tax", intentClass: "compliance" },
  { primaryIntent: "payroll compliance calendar philippines", ownerPath: "/compliance/calendar", intentClass: "compliance" },
  { primaryIntent: "payroll regulatory update process philippines", ownerPath: "/compliance/regulatory-updates", intentClass: "compliance", supportingIntents: ["payroll regulatory update governance philippines"], note: "Evergreen process/methodology intent. The dated update archive is /resources/updates." },
  { primaryIntent: "payroll audit philippines", ownerPath: "/compliance/payroll-audit", intentClass: "compliance" },

  { primaryIntent: "bpo payroll software philippines", ownerPath: "/industries/bpo", intentClass: "industry" },
  { primaryIntent: "manpower payroll software philippines", ownerPath: "/industries/manpower", intentClass: "industry" },
  { primaryIntent: "manufacturing payroll software philippines", ownerPath: "/industries/manufacturing", intentClass: "industry" },
  { primaryIntent: "construction payroll software philippines", ownerPath: "/industries/construction", intentClass: "industry", supportingIntents: ["construction payroll system philippines", "payroll software for construction companies philippines"] },
  { primaryIntent: "logistics payroll software philippines", ownerPath: "/industries/logistics", intentClass: "industry", supportingIntents: ["logistics payroll system philippines", "payroll software for logistics companies philippines"] },
  { primaryIntent: "security agency payroll software philippines", ownerPath: "/industries/security-agencies", intentClass: "industry", supportingIntents: ["security guard payroll system philippines", "payroll software for security agencies philippines"] },
  { primaryIntent: "retail payroll software philippines", ownerPath: "/industries/retail", intentClass: "industry" },
  { primaryIntent: "healthcare payroll software philippines", ownerPath: "/industries/healthcare", intentClass: "industry" },
  { primaryIntent: "hospitality payroll software philippines", ownerPath: "/industries/hospitality", intentClass: "industry" },
  { primaryIntent: "banking finance payroll software philippines", ownerPath: "/industries/banking-finance", intentClass: "industry" },
  { primaryIntent: "education payroll software philippines", ownerPath: "/industries/education", intentClass: "industry" },
  { primaryIntent: "accounting firm payroll software philippines", ownerPath: "/industries/accounting-firms", intentClass: "industry" },
  { primaryIntent: "real estate payroll software philippines", ownerPath: "/industries/real-estate", intentClass: "industry" },
  { primaryIntent: "media payroll software philippines", ownerPath: "/industries/media", intentClass: "industry" },
  { primaryIntent: "ngo payroll software philippines", ownerPath: "/industries/ngo", intentClass: "industry", supportingIntents: ["nonprofit payroll software philippines"] },
  { primaryIntent: "shopping center payroll software philippines", ownerPath: "/industries/shopping-centers", intentClass: "industry" },

  { primaryIntent: "best payroll software philippines", ownerPath: "/resources/best-payroll-software-philippines", intentClass: "guide" },
  {
    primaryIntent: "sprout payroll alternative philippines",
    ownerPath: "/resources/sprout-payroll-alternative",
    intentClass: "guide",
    supportingIntents: ["sprout payroll alternatives", "alternative to sprout payroll philippines"],
    note: "Branded competitor-alternative intent only. Do not broaden into generic payroll software Philippines intent.",
  },
  {
    primaryIntent: "salarium alternative philippines",
    ownerPath: "/resources/salarium-alternative",
    intentClass: "guide",
    supportingIntents: ["salarium alternatives", "alternative to salarium philippines"],
    note: "Branded competitor-alternative intent only. Do not broaden into generic payroll software Philippines intent.",
  },
  { primaryIntent: "payroll software vs outsourcing philippines", ownerPath: "/resources/payroll-software-vs-outsourcing", intentClass: "guide" },
  {
    primaryIntent: "payroll software vs excel",
    ownerPath: "/resources/payroll-software-vs-excel",
    intentClass: "guide",
    supportingIntents: [
      "manual payroll vs software philippines",
      "manual payroll vs payroll software philippines",
      "spreadsheet payroll vs software philippines",
    ],
    note: "Own spreadsheet/manual-payroll comparison intent. Do not create a second manual-payroll comparison URL.",
  },
  { primaryIntent: "cloud vs on premise payroll", ownerPath: "/resources/cloud-vs-on-premise-payroll", intentClass: "guide" },
  { primaryIntent: "build vs buy payroll software", ownerPath: "/resources/build-vs-buy-payroll-software", intentClass: "guide" },
  { primaryIntent: "payroll migration checklist philippines", ownerPath: "/resources/payroll-migration-checklist", intentClass: "guide" },
  { primaryIntent: "payroll security checklist guide philippines", ownerPath: "/resources/payroll-security-checklist", intentClass: "guide", supportingIntents: ["payroll security evaluation guide philippines"] },
  { primaryIntent: "payroll rfp checklist guide philippines", ownerPath: "/resources/payroll-rfp-checklist", intentClass: "guide", supportingIntents: ["payroll rfp evaluation guide philippines"] },
  { primaryIntent: "payroll implementation guide philippines", ownerPath: "/resources/payroll-implementation-guide", intentClass: "guide" },
  { primaryIntent: "payroll software roi", ownerPath: "/resources/payroll-software-roi", intentClass: "guide" },
  { primaryIntent: "hris vs payroll system philippines", ownerPath: "/resources/hris-vs-payroll-system", intentClass: "guide" },
  {
    primaryIntent: "payroll system comparison philippines",
    ownerPath: "/resources/payroll-system-comparison",
    intentClass: "guide",
    supportingIntents: ["payroll software comparison philippines"],
  },
  {
    primaryIntent: "payroll outsourcing cost philippines",
    ownerPath: "/resources/payroll-outsourcing-cost",
    intentClass: "guide",
    supportingIntents: ["cost of payroll outsourcing philippines"],
  },
  {
    primaryIntent: "how payroll outsourcing works philippines",
    ownerPath: "/resources/payroll-outsourcing-guide",
    intentClass: "guide",
    supportingIntents: ["payroll outsourcing process philippines"],
    note: "Informational process intent. The commercial payroll outsourcing owner remains /payroll-outsourcing.",
  },
  { primaryIntent: "13th month pay philippines guide", ownerPath: "/resources/13th-month-pay-philippines", intentClass: "guide" },
  { primaryIntent: "overtime pay philippines guide", ownerPath: "/resources/overtime-pay-philippines", intentClass: "guide" },
  { primaryIntent: "night differential philippines guide", ownerPath: "/resources/night-differential-philippines", intentClass: "guide" },
  { primaryIntent: "holiday pay philippines guide", ownerPath: "/resources/holiday-pay-philippines", intentClass: "guide" },
  { primaryIntent: "final pay philippines", ownerPath: "/resources/final-pay-philippines", intentClass: "guide" },
  { primaryIntent: "separation pay philippines", ownerPath: "/resources/separation-pay-philippines", intentClass: "guide" },
  { primaryIntent: "payroll process philippines", ownerPath: "/resources/payroll-process-philippines", intentClass: "guide" },
  { primaryIntent: "payroll cutoff guide", ownerPath: "/resources/payroll-cutoff", intentClass: "guide" },
  { primaryIntent: "common payroll errors", ownerPath: "/resources/common-payroll-errors", intentClass: "guide" },
  { primaryIntent: "payroll audit checklist", ownerPath: "/resources/payroll-audit-checklist", intentClass: "guide" },
  { primaryIntent: "payslip guide philippines", ownerPath: "/resources/payslip-guide", intentClass: "guide" },
  { primaryIntent: "payroll annualization guide", ownerPath: "/resources/payroll-annualization", intentClass: "guide" },
  {
    primaryIntent: "employee loans payroll philippines",
    ownerPath: "/resources/employee-loans-payroll",
    intentClass: "guide",
    supportingIntents: ["employee loan deductions payroll philippines", "payroll loan deductions philippines"],
  },
  {
    primaryIntent: "retroactive pay philippines",
    ownerPath: "/resources/retroactive-pay",
    intentClass: "guide",
    supportingIntents: ["retro pay philippines", "retroactive salary adjustment philippines"],
    note: "Own payroll mechanics/process intent. Do not present the page as a universal legal-entitlement determination.",
  },

  {
    primaryIntent: "payroll calculators philippines",
    ownerPath: "/calculators",
    intentClass: "calculator",
    supportingIntents: ["philippine payroll calculators"],
  },
  {
    primaryIntent: "payroll software comparisons philippines",
    ownerPath: "/compare",
    intentClass: "guide",
    supportingIntents: ["payroll comparison guides philippines"],
  },
  {
    primaryIntent: "payroll software industries philippines",
    ownerPath: "/industries",
    intentClass: "industry",
    supportingIntents: ["payroll software by industry philippines"],
  },
  {
    primaryIntent: "linaw payroll evidence methodology",
    ownerPath: "/methodology",
    intentClass: "trust",
  },
  {
    primaryIntent: "payroll health check philippines",
    ownerPath: "/payroll-health-check",
    intentClass: "conversion",
    supportingIntents: ["payroll process health check philippines"],
  },
  {
    primaryIntent: "payroll guides philippines",
    ownerPath: "/resources",
    intentClass: "guide",
    supportingIntents: ["payroll resources philippines"],
  },
  {
    primaryIntent: "philippine payroll regulatory updates",
    ownerPath: "/resources/updates",
    intentClass: "guide",
    supportingIntents: ["payroll regulatory update archive philippines", "payroll updates philippines"],
  },
  { primaryIntent: "dole final pay reminder 2026", ownerPath: "/resources/updates/dole-final-pay-reminder-2026", intentClass: "guide" },
  { primaryIntent: "dole 13th month pay guidelines 2025", ownerPath: "/resources/updates/dole-13th-month-guidelines-2025", intentClass: "guide" },
  { primaryIntent: "bir alphalist reminder 2026", ownerPath: "/resources/updates/bir-alphalist-reminder-2026", intentClass: "guide" },
  {
    primaryIntent: "linaw payroll capability scorecard",
    ownerPath: "/scorecard",
    intentClass: "trust",
  },
  {
    primaryIntent: "payroll software rfp checklist template philippines",
    ownerPath: "/templates/payroll-rfp-checklist",
    intentClass: "guide",
    supportingIntents: ["payroll rfp template philippines"],
  },
  {
    primaryIntent: "payroll software security checklist template philippines",
    ownerPath: "/templates/payroll-security-checklist",
    intentClass: "guide",
    supportingIntents: ["payroll security checklist template philippines"],
  },

  { primaryIntent: "13th month pay calculator philippines", ownerPath: "/calculators/13th-month-pay", intentClass: "calculator" },
  { primaryIntent: "overtime pay calculator philippines", ownerPath: "/calculators/overtime-pay", intentClass: "calculator" },
  { primaryIntent: "night differential calculator philippines", ownerPath: "/calculators/night-differential", intentClass: "calculator" },
  { primaryIntent: "holiday pay calculator philippines", ownerPath: "/calculators/holiday-pay", intentClass: "calculator" },
  { primaryIntent: "sss contribution calculator philippines", ownerPath: "/calculators/sss-contribution", intentClass: "calculator" },
  { primaryIntent: "philhealth contribution calculator philippines", ownerPath: "/calculators/philhealth-contribution", intentClass: "calculator" },
  { primaryIntent: "pag-ibig contribution calculator philippines", ownerPath: "/calculators/pag-ibig-contribution", intentClass: "calculator" },
  { primaryIntent: "withholding tax calculator philippines", ownerPath: "/calculators/withholding-tax", intentClass: "calculator" },
  { primaryIntent: "final pay calculator philippines", ownerPath: "/calculators/final-pay", intentClass: "calculator" },
  { primaryIntent: "payroll cost calculator philippines", ownerPath: "/calculators/payroll-cost", intentClass: "calculator" },
  { primaryIntent: "daily rate calculator philippines", ownerPath: "/calculators/daily-rate", intentClass: "calculator" },
  { primaryIntent: "hourly rate calculator philippines", ownerPath: "/calculators/hourly-rate", intentClass: "calculator" },
  { primaryIntent: "payroll outsourcing roi calculator philippines", ownerPath: "/calculators/payroll-outsourcing-roi", intentClass: "calculator" },

  { primaryIntent: "payroll glossary philippines", ownerPath: "/glossary", intentClass: "glossary" },
  { primaryIntent: "basic salary payroll definition philippines", ownerPath: "/glossary/basic-salary", intentClass: "glossary" },
  { primaryIntent: "gross pay payroll definition philippines", ownerPath: "/glossary/gross-pay", intentClass: "glossary" },
  { primaryIntent: "net pay payroll definition philippines", ownerPath: "/glossary/net-pay", intentClass: "glossary" },
  { primaryIntent: "taxable compensation definition philippines", ownerPath: "/glossary/taxable-compensation", intentClass: "glossary" },
  { primaryIntent: "payroll cutoff definition philippines", ownerPath: "/glossary/payroll-cutoff", intentClass: "glossary" },
  { primaryIntent: "night differential definition philippines", ownerPath: "/glossary/night-differential", intentClass: "glossary" },
  { primaryIntent: "premium pay definition philippines", ownerPath: "/glossary/premium-pay", intentClass: "glossary" },
  { primaryIntent: "rest day payroll definition philippines", ownerPath: "/glossary/rest-day", intentClass: "glossary" },
  { primaryIntent: "withholding tax payroll definition", ownerPath: "/glossary/withholding-tax", intentClass: "glossary" },
  { primaryIntent: "monthly salary credit definition philippines", ownerPath: "/glossary/monthly-salary-credit", intentClass: "glossary" },
  { primaryIntent: "13th month pay definition philippines", ownerPath: "/glossary/13th-month-pay", intentClass: "glossary" },
  { primaryIntent: "payroll annualization definition philippines", ownerPath: "/glossary/annualization", intentClass: "glossary" },
  { primaryIntent: "payroll software trial philippines", ownerPath: "/trial", intentClass: "conversion" },
  {
    primaryIntent: "payroll software demo philippines",
    ownerPath: "/demo",
    intentClass: "conversion",
    supportingIntents: ["live payroll software demo philippines", "payroll product demo philippines"],
    note: "Own self-serve product-demo intent using populated sample data.",
  },
  {
    primaryIntent: "book payroll software demo philippines",
    ownerPath: "/book-demo",
    intentClass: "conversion",
    supportingIntents: ["schedule payroll software demo philippines", "payroll software walkthrough philippines"],
    note: "Own guided sales-conversation intent; do not compete with the self-serve /demo route.",
  },
];

export function normalizeSeoIntent(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function duplicateSeoIntentOwners() {
  const seen = new Map<string, SeoIntentOwner[]>();

  for (const owner of SEO_INTENT_OWNERS) {
    const keys = [owner.primaryIntent, ...(owner.supportingIntents ?? [])].map(normalizeSeoIntent);
    for (const key of keys) {
      const owners = seen.get(key) ?? [];
      owners.push(owner);
      seen.set(key, owners);
    }
  }

  return [...seen.entries()]
    .filter(([, owners]) => new Set(owners.map((owner) => owner.ownerPath)).size > 1)
    .map(([intent, owners]) => ({
      intent,
      ownerPaths: [...new Set(owners.map((owner) => owner.ownerPath))],
    }));
}

export function duplicateSeoOwnerPaths() {
  const counts = new Map<string, number>();
  for (const owner of SEO_INTENT_OWNERS) {
    counts.set(owner.ownerPath, (counts.get(owner.ownerPath) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([path, count]) => ({ path, count }));
}

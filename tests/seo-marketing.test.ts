import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("public SEO infrastructure exists", () => {
  assert.ok(existsSync("src/app/sitemap.xml/route.ts"), "public sitemap index route must exist");
  assert.ok(existsSync("src/lib/sitemap-data.ts"), "segmented sitemap data must exist");
  assert.ok(existsSync("src/app/robots.ts"), "robots route must exist");

  const sitemap = read("src/lib/sitemap-data.ts");
  const robots = read("src/app/robots.ts");
  for (const route of ["/hris", "/time-and-attendance", "/employee-self-service", "/compliance", "/implementation", "/security", "/trust", "/integrations", "/developers", "/resources", "/calculators", "/payroll-health-check", "/industries/bpo"]) {
    assert.ok(sitemap.includes(`path: "${route}"`), `sitemap must include ${route}`);
  }
  assert.ok(sitemap.includes("compliancePages") && sitemap.includes("complianceWave3"), "compliance child pages must be generated into segmented sitemap data");
  assert.ok(sitemap.includes("resourcePages") && sitemap.includes("resourceWave2"), "resource child pages from both SEO waves must be generated into the sitemap");
  assert.ok(sitemap.includes("Object.keys(CALCULATORS)"), "calculator pages must be generated into the sitemap");
  assert.ok(robots.includes('"/api/"'), "robots must keep API routes out of crawl discovery");
  assert.ok(robots.includes('"/app"'), "robots must keep the authenticated app out of crawl discovery");
});

test("homepage and authority routes keep distinct search intent ownership", () => {
  const home = read("src/app/page.tsx");
  const hris = read("src/app/hris/page.tsx");
  assert.ok(home.includes("Payroll Software Philippines | Payroll System | Linaw"), "homepage must own payroll software intent");
  assert.ok(!home.includes("HRIS & Payroll System"), "homepage must not reuse the HRIS title cluster");
  assert.ok(hris.includes("HRIS Philippines"), "/hris must own HRIS Philippines intent");
});

test("small-business payroll has a dedicated commercial owner page", () => {
  const page = read("src/app/small-business-payroll/page.tsx");
  const intents = read("src/lib/seo-intent-ownership.ts");
  const sitemap = read("src/lib/sitemap-data.ts");
  const nav = read("src/components/marketing/public-navigation.ts");

  assert.ok(page.includes('title: "Small Business Payroll Software Philippines | Linaw"'));
  assert.ok(page.includes('alternates: { canonical: "/small-business-payroll" }'));
  assert.ok(page.includes('service={{'));
  assert.ok(page.includes('faq={faq}'));
  assert.ok(intents.includes('primaryIntent: "small business payroll software philippines"'));
  assert.ok(intents.includes('ownerPath: "/small-business-payroll"'));
  assert.ok(sitemap.includes('path: "/small-business-payroll"'));
  assert.ok(nav.includes('href: "/small-business-payroll"'));
});

test("money and authority pages have dedicated indexable routes", () => {
  const pages = [
    ["src/app/hris/page.tsx", "HRIS Philippines"],
    ["src/app/time-and-attendance/page.tsx", "Timekeeping System Philippines"],
    ["src/app/employee-self-service/page.tsx", "Employee Self-Service Philippines"],
    ["src/app/compliance/page.tsx", "Payroll Compliance Philippines"],
    ["src/app/implementation/page.tsx", "Payroll System Implementation Philippines"],
    ["src/app/security/page.tsx", "Payroll Software Security Philippines"],
    ["src/app/industries/bpo/page.tsx", "BPO Payroll Software Philippines"],
    ["src/app/pricing/page.tsx", "Payroll Software Pricing Philippines"],
  ] as const;

  for (const [path, keyword] of pages) {
    assert.ok(existsSync(path), `${path} must exist`);
    const source = read(path);
    assert.ok(source.includes(keyword), `${path} metadata must target ${keyword}`);
    assert.ok(source.includes("alternates: { canonical:"), `${path} must declare a canonical`);
  }
});

test("config-driven compliance, resource and industry clusters exist", () => {
  const content = read("src/lib/seo-content.ts");
  for (const slug of ["bir", "sss", "philhealth", "pag-ibig", "dole"]) {
    assert.ok(content.includes(`slug: "${slug}"`), `compliance cluster must include ${slug}`);
  }
  for (const slug of ["best-payroll-software-philippines", "payroll-software-vs-outsourcing", "payroll-migration-checklist", "payroll-security-checklist", "payroll-software-vs-excel"]) {
    assert.ok(content.includes(`slug: "${slug}"`), `resource cluster must include ${slug}`);
  }
  for (const slug of ["accounting-firms", "manpower", "manufacturing"]) {
    assert.ok(content.includes(`slug: "${slug}"`), `industry cluster must include ${slug}`);
  }
});

test("calculator pages reuse payroll rule functions", () => {
  const calculator = read("src/components/marketing/payroll-calculator.tsx");
  for (const helper of ["computeSss", "computePhilHealth", "computePagIbig", "computeMonthlyWithholdingTax", "holidayMultiplier", "computeThirteenthMonthPay"]) {
    assert.ok(calculator.includes(helper), `calculator must reuse ${helper}`);
  }
  assert.ok(calculator.includes("Educational estimate only"), "calculator must carry an explicit estimate disclaimer");
});

test("calculator pages have unique metadata, explanation depth and FAQ schema", () => {
  const config = read("src/lib/calculators.ts");
  const page = read("src/app/calculators/[slug]/page.tsx");
  const structured = read("src/components/marketing/structured-data.tsx");

  for (const slug of [
    "13th-month-pay",
    "overtime-pay",
    "night-differential",
    "holiday-pay",
    "sss-contribution",
    "philhealth-contribution",
    "pag-ibig-contribution",
    "withholding-tax",
    "payroll-cost",
    "final-pay",
    "daily-rate",
    "hourly-rate",
    "payroll-outsourcing-roi",
  ]) {
    const start = config.indexOf(`"${slug}": {`, config.indexOf("CALCULATOR_GUIDES"));
    const end = config.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `calculator guide ${slug} must exist`);
    const block = config.slice(start, end);
    assert.ok(block.includes("metaTitle:"), `calculator guide ${slug} must have a unique meta title`);
    assert.ok(block.includes("howItWorks:"), `calculator guide ${slug} must explain how the estimate works`);
    assert.ok(block.includes("assumptions:"), `calculator guide ${slug} must document assumptions`);
    assert.ok(block.includes("faq:"), `calculator guide ${slug} must include FAQ depth`);
  }

  assert.ok(page.includes("guide.howItWorks"), "calculator page must render calculation context");
  assert.ok(page.includes("guide.assumptions.map"), "calculator page must render assumptions");
  assert.ok(page.includes("guide.faq.map"), "calculator page must render FAQs");
  assert.ok(page.includes("faq={guide.faq}"), "calculator page must pass FAQs into structured data");
  assert.ok(structured.includes('"@type": "FAQPage"'), "shared structured data must support FAQPage schema");
});

test("high-intent calculators link to their exact guide or compliance owner and back", () => {
  const calculatorPage = read("src/app/calculators/[slug]/page.tsx");
  const wave3 = read("src/lib/seo-content-wave3.ts");

  for (const [calculatorSlug, target] of [
    ["13th-month-pay", "/resources/13th-month-pay-philippines"],
    ["overtime-pay", "/resources/overtime-pay-philippines"],
    ["night-differential", "/resources/night-differential-philippines"],
    ["holiday-pay", "/resources/holiday-pay-philippines"],
    ["withholding-tax", "/compliance/withholding-tax"],
  ] as const) {
    const start = calculatorPage.indexOf(`"${calculatorSlug}": [`);
    const end = calculatorPage.indexOf("\n  ],", start);
    assert.ok(start >= 0 && end > start, `calculator related block ${calculatorSlug} must exist`);
    assert.ok(
      calculatorPage.slice(start, end).includes(`href: "${target}"`),
      `${calculatorSlug} calculator must link to exact intent owner ${target}`,
    );
  }

  for (const [ownerSlug, calculatorPath] of [
    ["13th-month-pay-philippines", "/calculators/13th-month-pay"],
    ["overtime-pay-philippines", "/calculators/overtime-pay"],
    ["night-differential-philippines", "/calculators/night-differential"],
    ["holiday-pay-philippines", "/calculators/holiday-pay"],
    ["withholding-tax", "/calculators/withholding-tax"],
  ] as const) {
    const start = wave3.indexOf(`slug: "${ownerSlug}"`);
    const end = wave3.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `intent owner ${ownerSlug} must exist`);
    assert.ok(
      wave3.slice(start, end).includes(`href: "${calculatorPath}"`),
      `${ownerSlug} must link back to ${calculatorPath}`,
    );
  }
});

test("public calculators keep one source of payroll math", () => {
  const calculator = read("src/components/marketing/payroll-calculator.tsx");
  const config = read("src/lib/calculators.ts");
  assert.ok(calculator.includes("computeSss") && calculator.includes("computePhilHealth") && calculator.includes("computePagIbig"));
  assert.ok(calculator.includes("computeMonthlyWithholdingTax") && calculator.includes("holidayMultiplier"));
  assert.ok(!config.includes("function computeSss"), "calculator content config must not duplicate SSS math");
  assert.ok(!config.includes("function computePhilHealth"), "calculator content config must not duplicate PhilHealth math");
  assert.ok(!config.includes("function computePagIbig"), "calculator content config must not duplicate Pag-IBIG math");
});

test("payroll health check does not collect employee PII or claim certification", () => {
  const health = read("src/components/marketing/payroll-health-check.tsx");
  assert.ok(health.includes("process-maturity screen"), "health check must describe itself as process maturity");
  assert.ok(health.includes("not a legal compliance certification"), "health check must not imply compliance certification");
  for (const pii of ["government ID", "bank account", "employee name"]) {
    assert.ok(!health.toLowerCase().includes(pii), `health-check questions must not collect ${pii}`);
  }
});

test("compliance copy does not overstate government filing readiness", () => {
  const page = read("src/app/compliance/page.tsx");
  const childContent = read("src/lib/seo-content.ts");
  assert.ok(page.includes("DRAFT until validated"), "compliance page must preserve government-output validation language");
  assert.ok(page.includes("calculation equals filing"), "compliance page must distinguish computation from filing readiness");
  assert.ok(childContent.includes("filing readiness separate"), "child guides must retain filing-validation separation");
  assert.ok(!childContent.includes("guaranteed compliance"), "compliance guides must not promise guaranteed compliance");
  assert.ok(!childContent.includes("100% compliant"), "compliance guides must not claim 100% compliance");
});

test("security and trust pages only claim repository-evidenced controls", () => {
  const security = read("src/app/security/page.tsx");
  const trust = read("src/app/trust/page.tsx");
  assert.ok(security.includes("TOTP multi-factor authentication"), "security page should expose implemented MFA");
  assert.ok(security.includes("Tenant isolation"), "security page should expose tenant-isolation controls");
  assert.ok(security.includes("does not claim ISO, SOC 2"), "security page must explicitly avoid unsupported certification claims");
  assert.ok(trust.includes("verified, partial or absent"), "trust center must preserve evidence-status language");
});

test("developer center matches implemented API security model", () => {
  const page = read("src/app/developers/page.tsx");
  const route = read("src/app/api/developer/route.ts");
  assert.ok(page.includes("SHA-256 hashed API keys"));
  assert.ok(page.includes("HMAC-SHA256 webhook signatures"));
  assert.ok(route.includes("ALLOWED_API_SCOPES"), "developer route must define explicit scopes");
  assert.ok(route.includes("requireSensitiveActionMfa"), "developer credential mutations must retain MFA-sensitive control");
});

test("non-content auth routes stay out of the search index", () => {
  const login = read("src/app/login/page.tsx");
  const signup = read("src/app/signup/page.tsx");
  for (const source of [login, signup]) {
    assert.ok(source.includes("robots: { index: false, follow: false }"), "login and signup must be noindex");
  }
});

test("canonical host fallback stays aligned with payrollsoftware.ph, not the deployment origin", () => {
  const helper = read("src/lib/site-url.ts");
  assert.ok(helper.includes('PUBLIC_SITE_URL = "https://payrollsoftware.ph"'), "public canonical origin must be fixed to payrollsoftware.ph");
  assert.ok(!helper.includes("process.env"), "public canonical origin must not vary by deployment environment");
  assert.ok(!helper.includes("APP_BASE_URL"), "deployment origin must not control SEO canonicals");
  assert.ok(!helper.includes("vercel.app"), "Vercel deployment domains must not be canonical fallbacks");
});

test("buyer guides use page-specific metadata instead of generic eyebrow titles", () => {
  const resourceRoute = read("src/app/resources/[slug]/page.tsx");
  const content = read("src/lib/seo-content.ts");
  assert.ok(resourceRoute.includes("page.metaTitle ??"), "resource route must prefer a page-specific meta title");
  for (const title of [
    "Best Payroll Software Philippines: Buyer Guide | Linaw",
    "Payroll Software vs Outsourcing Philippines | Linaw",
    "Payroll Migration Checklist Philippines | Linaw",
    "Payroll Security Checklist Guide Philippines | Linaw",
    "Payroll Software vs Excel Philippines | Linaw",
  ]) {
    assert.ok(content.includes(title), `buyer guide metadata must include ${title}`);
  }
});

test("authority pages support real FAQ depth and FAQ structured data", () => {
  const landing = read("src/components/marketing/seo-landing-page.tsx");
  const content = read("src/lib/seo-content.ts");
  assert.ok(landing.includes('"@type": "FAQPage"'), "authority template must emit FAQPage structured data");
  assert.ok(landing.includes("faq.map"), "authority template must render FAQ content visibly");
  for (const slug of [
    "best-payroll-software-philippines",
    "payroll-software-vs-outsourcing",
    "payroll-migration-checklist",
    "payroll-security-checklist",
    "payroll-software-vs-excel",
  ]) {
    const start = content.indexOf(`slug: "${slug}"`);
    const end = content.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `resource page ${slug} must exist`);
    assert.ok(content.slice(start, end).includes("faq: ["), `resource page ${slug} must include FAQ depth`);
  }
});

test("integration, developer and trust pages keep distinct authority intent", () => {
  const integrations = read("src/app/integrations/page.tsx");
  const developers = read("src/app/developers/page.tsx");
  const trust = read("src/app/trust/page.tsx");
  assert.ok(integrations.includes("Payroll Integrations Philippines | API & Webhooks | Linaw"));
  assert.ok(integrations.includes("Does an export file count as a native integration?"));
  assert.ok(developers.includes("Payroll API Philippines | Developer Center | Linaw"));
  assert.ok(developers.includes("What API scopes are available today?"));
  assert.ok(trust.includes("Payroll Trust Center | Security & Product Evidence | Linaw"));
  assert.ok(trust.includes("Does a green CI run mean payroll is certified for production?"));
});

test("long dynamic compliance and industry H1s have dedicated search titles", () => {
  const content = read("src/lib/seo-content.ts");
  for (const title of [
    "PhilHealth Payroll Compliance Philippines | Linaw",
    "Pag-IBIG Payroll Compliance Philippines | Linaw",
    "Payroll Software for Accounting Firms Philippines | Linaw",
    "Manpower Payroll Software Philippines | Linaw",
    "Manufacturing Payroll Software Philippines | Linaw",
  ]) {
    assert.ok(content.includes(title), `SEO content must include ${title}`);
  }
});

test("core and operational compliance guides include FAQ depth", () => {
  const core = read("src/lib/seo-content.ts");
  const wave3 = read("src/lib/seo-content-wave3.ts");

  for (const slug of ["bir", "sss", "philhealth", "pag-ibig", "dole"]) {
    const start = core.indexOf(`slug: "${slug}"`);
    const end = core.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `core compliance page ${slug} must exist`);
    assert.ok(core.slice(start, end).includes("faq: ["), `core compliance page ${slug} must include FAQ depth`);
  }

  for (const slug of ["calendar", "regulatory-updates", "payroll-audit"]) {
    const start = wave3.indexOf(`slug: "${slug}"`);
    const end = wave3.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `compliance operations page ${slug} must exist`);
    assert.ok(wave3.slice(start, end).includes("faq: ["), `compliance operations page ${slug} must include FAQ depth`);
  }
});

test("wave 3 payroll operations guides keep FAQ depth and review dates", () => {
  const wave3 = read("src/lib/seo-content-wave3.ts");
  for (const slug of [
    "night-differential-philippines",
    "holiday-pay-philippines",
    "separation-pay-philippines",
    "payroll-process-philippines",
    "payroll-cutoff",
    "common-payroll-errors",
    "payroll-audit-checklist",
    "payslip-guide",
    "payroll-annualization",
  ]) {
    const start = wave3.indexOf(`slug: "${slug}"`);
    const end = wave3.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `wave 3 guide ${slug} must exist`);
    const page = wave3.slice(start, end);
    assert.ok(page.includes("faq: ["), `wave 3 guide ${slug} must include FAQ depth`);
    assert.ok(page.includes("lastReviewedIso: reviewedIso"), `wave 3 guide ${slug} must expose a structured review date`);
  }
});

test("statutory wave 3 guides preserve official reference links", () => {
  const wave3 = read("src/lib/seo-content-wave3.ts");
  for (const slug of [
    "night-differential-philippines",
    "holiday-pay-philippines",
    "separation-pay-philippines",
    "payroll-annualization",
  ]) {
    const start = wave3.indexOf(`slug: "${slug}"`);
    const end = wave3.indexOf("\n  },", start);
    const page = wave3.slice(start, end);
    assert.ok(page.includes("sources: ["), `statutory guide ${slug} must retain official sources`);
  }
  assert.ok(wave3.includes("DOLE Workers' Statutory Monetary Benefits Handbook"));
  assert.ok(wave3.includes("BIR Form 2316 information"));
});

test("core industry pages keep commercial FAQ depth", () => {
  const core = read("src/lib/seo-content.ts");
  const bpo = read("src/app/industries/bpo/page.tsx");

  for (const slug of ["accounting-firms", "manpower", "manufacturing"]) {
    const start = core.indexOf(`slug: "${slug}"`);
    const end = core.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `core industry page ${slug} must exist`);
    assert.ok(core.slice(start, end).includes("faq: ["), `core industry page ${slug} must include FAQ depth`);
  }

  assert.ok(bpo.includes("faq={["), "BPO industry page must keep FAQ depth");
});

test("payroll glossary entries have useful search and explanatory depth", () => {
  const wave3 = read("src/lib/seo-content-wave3.ts");
  const page = read("src/app/glossary/[slug]/page.tsx");
  const structured = read("src/components/marketing/structured-data.tsx");

  for (const slug of [
    "basic-salary",
    "gross-pay",
    "net-pay",
    "taxable-compensation",
    "payroll-cutoff",
    "night-differential",
    "premium-pay",
    "rest-day",
    "withholding-tax",
    "monthly-salary-credit",
    "13th-month-pay",
    "annualization",
  ]) {
    const start = wave3.indexOf(`slug: "${slug}"`, wave3.indexOf("glossaryEntries"));
    const end = wave3.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `glossary entry ${slug} must exist`);
    const entry = wave3.slice(start, end);
    assert.ok(entry.includes("metaDescription:"), `glossary entry ${slug} must have a search description`);
    assert.ok(entry.includes("whyItMatters:"), `glossary entry ${slug} must explain payroll relevance`);
    assert.ok(entry.includes("example:"), `glossary entry ${slug} must include a concrete example`);
    assert.ok(entry.includes("related:"), `glossary entry ${slug} must keep internal links`);
  }

  assert.ok(page.includes("description: entry.metaDescription"), "glossary metadata must use the page-specific search description");
  assert.ok(page.includes("entry.whyItMatters"), "glossary page must render payroll relevance");
  assert.ok(page.includes("entry.example"), "glossary page must render the concrete example");
  assert.ok(page.includes("definedTerm={{"), "glossary page must keep DefinedTerm structured data");
  assert.ok(structured.includes('"@type": "DefinedTerm"'), "shared structured data must support DefinedTerm schema");
});

test("dated regulatory updates stay source-specific and actionable", () => {
  const wave3 = read("src/lib/seo-content-wave3.ts");
  const page = read("src/app/resources/updates/[slug]/page.tsx");

  for (const slug of [
    "dole-final-pay-reminder-2026",
    "dole-13th-month-guidelines-2025",
    "bir-alphalist-reminder-2026",
  ]) {
    const start = wave3.indexOf(`slug: "${slug}"`, wave3.indexOf("regulatoryUpdates"));
    const end = wave3.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `regulatory update ${slug} must exist`);
    const update = wave3.slice(start, end);
    assert.ok(update.includes("reviewedDate:"), `regulatory update ${slug} must track its review date`);
    assert.ok(update.includes("whatChanged: ["), `regulatory update ${slug} must explain what changed`);
    assert.ok(update.includes("payrollActions: ["), `regulatory update ${slug} must tell payroll teams what to check`);
    assert.ok(update.includes("sourceUrl:"), `regulatory update ${slug} must keep an official source`);
  }

  assert.ok(wave3.includes("labor-advisory-no-16-25-guidelines-on-the-payment-of-the-thirteenth-month-pay"), "13th-month update must link directly to the official DOLE advisory");
  assert.ok(page.includes("dateModified: update.reviewedDate"), "Article schema must use each update's review date");
  assert.ok(page.includes("update.whatChanged.map"), "update page must render the change summary");
  assert.ok(page.includes("update.payrollActions.map"), "update page must render payroll actions");
  assert.ok(page.includes("Open {update.sourceLabel}"), "official source CTA must identify the source");
});

test("new SEO waves keep search snippets concise", () => {
  for (const path of [
    "src/lib/seo-content-wave2.ts",
    "src/lib/seo-content-wave6.ts",
    "src/lib/seo-content-wave14.ts",
  ]) {
    const source = read(path);
    const descriptions = [...source.matchAll(/slug:\s*"[^"]+"[\s\S]*?description:\s*"([^"]+)"[\s\S]*?intro:/g)].map((match) => match[1]);
    assert.ok(descriptions.length > 0, `${path} must expose page-level descriptions`);
    for (const description of descriptions) {
      assert.ok(description.length <= 160, `${path} has an overlong meta description: ${description.length} chars`);
      assert.ok(description.length >= 120, `${path} has a thin meta description: ${description.length} chars`);
    }
  }
});

test("SEO hubs group large route inventories by user intent", () => {
  const resources = read("src/app/resources/page.tsx");
  const industries = read("src/app/industries/page.tsx");
  const calculators = read("src/app/calculators/page.tsx");

  for (const heading of [
    "Choose and compare payroll software",
    "Implement and operate payroll",
    "Understand pay rules and employee outcomes",
    "Evaluate payroll outsourcing",
  ]) {
    assert.ok(resources.includes(heading), `resources hub must include ${heading}`);
  }
  assert.ok(resources.includes("resourceGroups.map"), "resources hub must render grouped resource sections");
  assert.ok(resources.includes("group.slugs.map"), "resources hub must render resources from explicit group membership");

  for (const heading of [
    "Shift-heavy and frontline operations",
    "Distributed and field workforces",
    "Professional and institutional organizations",
  ]) {
    assert.ok(industries.includes(heading), `industries hub must include ${heading}`);
  }
  assert.ok(industries.includes("StructuredData"), "industries hub must keep breadcrumb structured data");

  for (const heading of [
    "Pay, time and final-pay estimates",
    "Statutory contribution estimates",
    "Tax and employer-cost planning",
  ]) {
    assert.ok(calculators.includes(heading), `calculators hub must include ${heading}`);
  }
  assert.ok(calculators.includes("type CalculatorSlug"), "calculator groups must be constrained to valid calculator slugs");
  assert.ok(calculators.includes("StructuredData"), "calculators hub must keep breadcrumb structured data");
});

test("compliance hub groups agency, BIR and governance workflows", () => {
  const page = read("src/app/compliance/page.tsx");
  const landing = read("src/components/marketing/seo-landing-page.tsx");

  for (const heading of [
    "Core statutory agencies and pay rules",
    "BIR withholding and year-end reporting",
    "Governance, deadlines and evidence",
  ]) {
    assert.ok(page.includes(heading), `compliance hub must include ${heading}`);
  }

  for (const route of [
    "/compliance/bir",
    "/compliance/sss",
    "/compliance/philhealth",
    "/compliance/pag-ibig",
    "/compliance/dole",
    "/compliance/withholding-tax",
    "/compliance/bir-2316",
    "/compliance/1601-c",
    "/compliance/alphalist",
    "/compliance/calendar",
    "/compliance/regulatory-updates",
    "/resources/updates",
    "/compliance/payroll-audit",
  ]) {
    assert.equal(page.split(`href: "${route}"`).length - 1, 1, `compliance hub must expose ${route} exactly once`);
  }

  assert.ok(page.includes("directoryGroups={["), "compliance hub must use grouped directory rendering");
  assert.ok(landing.includes("directoryGroups.map"), "shared authority template must render grouped directories");
  assert.ok(landing.includes("Find the compliance workflow you actually need."), "directory must explain its browsing purpose");
});

test("industry authority pages stay maintained and decision-focused", () => {
  const route = read("src/app/industries/[slug]/page.tsx");
  const base = read("src/lib/seo-content.ts");
  const wave2 = read("src/lib/seo-content-wave2.ts");
  const wave6 = read("src/lib/seo-content-wave6.ts");
  const bpo = read("src/app/industries/bpo/page.tsx");

  assert.ok(route.includes("lastReviewed={page.lastReviewed}"), "dynamic industry pages must show review dates when provided");
  assert.ok(route.includes("sources={page.sources}"), "dynamic industry pages must support evidence sources when provided");
  assert.ok(bpo.includes('lastReviewed="October 5, 2026"'), "BPO industry page must show a review date");
  assert.ok(bpo.includes("<StructuredData"), "BPO industry page must emit structured data");
  assert.ok(bpo.includes('path: "/industries/bpo"'), "BPO structured data must use the canonical industry path");

  for (const source of [base, wave2, wave6]) {
    assert.ok(source.includes('lastReviewed: "October 5, 2026"'), "industry content must carry explicit review dates");
  }

  for (const slug of ["real-estate", "media", "ngo", "shopping-centers"]) {
    const start = wave6.indexOf(`slug: "${slug}"`);
    const end = wave6.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `industry page ${slug} must exist`);
    const item = wave6.slice(start, end);
    const faqCount = (item.match(/question:/g) ?? []).length;
    assert.ok(faqCount >= 4, `industry page ${slug} must have at least four FAQs`);
  }
});

test("statutory calculators show review freshness and official references", () => {
  const route = read("src/app/calculators/[slug]/page.tsx");
  const calculators = read("src/lib/calculators.ts");

  assert.ok(route.includes("CALCULATOR_LAST_REVIEWED"), "calculator pages must show a review date");
  assert.ok(route.includes("Official references"), "calculator pages must render official references when available");
  assert.ok(route.includes("does not replace employer review, agency filing, remittance or legal advice"), "calculator sources must preserve the estimate-only boundary");

  for (const slug of [
    "13th-month-pay",
    "overtime-pay",
    "night-differential",
    "holiday-pay",
    "sss-contribution",
    "philhealth-contribution",
    "pag-ibig-contribution",
    "withholding-tax",
    "payroll-cost",
  ]) {
    const start = calculators.indexOf(`"${slug}": [`, calculators.indexOf("CALCULATOR_SOURCES"));
    assert.ok(start >= 0, `calculator ${slug} must have official source references`);
  }

  assert.ok(calculators.includes("SSS Pay Contributions"), "calculator sources must identify the SSS reference");
  assert.ok(calculators.includes("PhilHealth Premium Contribution Advisory 2025-0002"), "calculator sources must identify the PhilHealth advisory");
  assert.ok(calculators.includes("Pag-IBIG 2025 Payment Guide"), "calculator sources must identify the current Pag-IBIG payment guide");
  assert.ok(calculators.includes("current ₱10,000 MFS"), "Pag-IBIG source labeling must reflect the current MFS evidence");
  assert.ok(calculators.includes("BIR Withholding Tax Calculator"), "calculator sources must identify the BIR reference");
  assert.ok(calculators.includes("DOLE Labor Code, Book III"), "calculator sources must identify the DOLE reference");
});

test("standalone SEO pages keep titles and descriptions in target SERP ranges", () => {
  const pages = [
    "src/app/page.tsx",
    "src/app/hris/page.tsx",
    "src/app/time-and-attendance/page.tsx",
    "src/app/employee-self-service/page.tsx",
    "src/app/compliance/page.tsx",
    "src/app/implementation/page.tsx",
    "src/app/security/page.tsx",
    "src/app/trust/page.tsx",
    "src/app/integrations/page.tsx",
    "src/app/developers/page.tsx",
    "src/app/pricing/page.tsx",
    "src/app/resources/page.tsx",
    "src/app/calculators/page.tsx",
    "src/app/payroll-health-check/page.tsx",
    "src/app/payroll-outsourcing/page.tsx",
  ];

  for (const path of pages) {
    const source = read(path);
    const title = source.match(/title:\s*"([^"]+)"/)?.[1] ?? "";
    const description = source.match(/description:\s*"([^"]+)"/)?.[1] ?? "";
    assert.ok(title.length >= 55 && title.length <= 60, `${path} title length ${title.length} should be 55–60 characters`);
    assert.ok(description.length >= 150 && description.length <= 160, `${path} description length ${description.length} should be 150–160 characters`);
  }
});

test("public navigation exposes the SEO program without hiding the live demo", () => {
  const navigation = read("src/components/marketing/public-navigation.ts");
  for (const route of ["/demo", "/resources", "/compliance", "/trust", "/integrations", "/developers", "/calculators", "/payroll-health-check", "/industries"]) {
    assert.ok(navigation.includes(`href: "${route}"`), `public navigation must expose ${route}`);
  }
});


test("homepage schema reuses the visible FAQ content and identifies the provider", () => {
  const home = read("src/app/page.tsx");
  const closing = read("src/components/marketing/claude-home/components/Closing.tsx");
  const faqData = read("src/components/marketing/homepage-faqs.ts");

  assert.ok(home.includes('"@type": "Organization"'), "homepage schema must identify Linaw as the provider organization");
  assert.ok(home.includes('"@type": "SoftwareApplication"'), "homepage must keep SoftwareApplication schema");
  assert.ok(home.includes('"@type": "FAQPage"'), "visible homepage FAQs must have FAQPage structured data");
  assert.ok(home.includes("HOMEPAGE_FAQS.map"), "FAQ schema must come from the visible FAQ source");
  assert.ok(closing.includes("HOMEPAGE_FAQS.map"), "visible FAQ must use the same shared FAQ source");
  assert.ok(faqData.includes("They stay labelled DRAFT"), "government-output qualification must stay in the shared FAQ copy");
  assert.ok(!home.includes("aggregateRating"), "homepage schema must not invent ratings");
  assert.ok(!home.includes("review:"), "homepage schema must not invent reviews");
});

test("outsourcing and key landing pages have page-specific share metadata", () => {
  const outsourcing = read("src/app/payroll-outsourcing/page.tsx");
  const demo = read("src/app/demo/page.tsx");
  const scorecard = read("src/app/scorecard/page.tsx");

  assert.ok(outsourcing.includes('"@type": "Service"'), "outsourcing page must expose Service schema");
  assert.ok(outsourcing.includes('serviceType: "Payroll outsourcing and managed payroll processing"'));
  assert.ok(!outsourcing.includes("aggregateRating"), "service schema must not invent ratings");

  for (const [name, source] of [["outsourcing", outsourcing], ["demo", demo], ["scorecard", scorecard]]) {
    assert.ok(source.includes("openGraph:"), `${name} must override generic homepage Open Graph metadata`);
    assert.ok(source.includes("twitter:"), `${name} must override generic homepage Twitter metadata`);
    assert.ok(source.includes('card: "summary_large_image"'), `${name} must keep large-image social cards`);
  }
});

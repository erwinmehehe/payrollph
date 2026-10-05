import { readFileSync } from "node:fs";
import { CALCULATORS } from "../src/lib/calculators";
import { compliancePages, industryPages, resourcePages } from "../src/lib/seo-content";
import { industryWave2, resourceWave2 } from "../src/lib/seo-content-wave2";
import { complianceWave3, glossaryEntries, regulatoryUpdates, resourceWave3 } from "../src/lib/seo-content-wave3";
import { industryWave6, integrationWave6 } from "../src/lib/seo-content-wave6";
import { resourceWave14 } from "../src/lib/seo-content-wave14";
import { resourceWave16 } from "../src/lib/seo-content-wave16";
import { PUBLISHABLE_CUSTOMER_STORIES } from "../src/lib/customer-stories";

type Issue = { code: string; message: string };

const issues: Issue[] = [];
const read = (path: string) => readFileSync(path, "utf8");

function requireSignal(source: string, signal: string, code: string, message: string) {
  if (!source.includes(signal)) issues.push({ code, message });
}

function requireExplicitSlugs(
  family: string,
  hubFile: string,
  slugs: readonly string[],
  routePrefix: string,
  hrefTemplateSignal: string,
) {
  const source = read(hubFile);
  requireSignal(
    source,
    hrefTemplateSignal,
    "missing-hub-link-template",
    `${family} hub ${hubFile} is missing its dynamic child-link template.`,
  );

  for (const slug of slugs) {
    if (!source.includes(`"${slug}"`)) {
      issues.push({
        code: "orphan-hub-child",
        message: `${routePrefix}/${slug} exists in the SEO catalog but is not assigned to a visible ${family} hub group.`,
      });
    }
  }
}

function requireLiteralRoutes(
  family: string,
  hubFile: string,
  routes: readonly string[],
) {
  const source = read(hubFile);
  for (const route of routes) {
    if (!source.includes(`href: "${route}"`) && !source.includes(`href="${route}"`)) {
      issues.push({
        code: "orphan-hub-child",
        message: `${route} exists in the SEO catalog but is not linked from the ${family} hub ${hubFile}.`,
      });
    }
  }
}

requireExplicitSlugs(
  "resources",
  "src/app/resources/page.tsx",
  [...resourcePages, ...resourceWave2, ...resourceWave3, ...resourceWave14, ...resourceWave16].map((page) => page.slug),
  "/resources",
  "href={`/resources/${page.slug}`}",
);

requireExplicitSlugs(
  "industries",
  "src/app/industries/page.tsx",
  ["bpo", ...industryPages.map((page) => page.slug), ...industryWave2.map((page) => page.slug), ...industryWave6.map((page) => page.slug)],
  "/industries",
  "href={`/industries/${item.slug}`}",
);

requireExplicitSlugs(
  "calculators",
  "src/app/calculators/page.tsx",
  Object.keys(CALCULATORS),
  "/calculators",
  "href={`/calculators/${slug}`}",
);

requireLiteralRoutes(
  "compliance",
  "src/app/compliance/page.tsx",
  [...compliancePages, ...complianceWave3].map((page) => `/compliance/${page.slug}`),
);

requireLiteralRoutes(
  "integrations",
  "src/app/integrations/page.tsx",
  integrationWave6.map((page) => `/integrations/${page.slug}`),
);

requireLiteralRoutes(
  "developer",
  "src/app/developers/page.tsx",
  ["/developers/authentication", "/developers/employees", "/developers/payroll-runs", "/developers/webhooks"],
);

const glossaryHub = read("src/app/glossary/page.tsx");
requireSignal(
  glossaryHub,
  "glossaryEntries.map",
  "missing-family-map",
  "Glossary hub must render every configured glossary entry.",
);
requireSignal(
  glossaryHub,
  "href={`/glossary/${entry.slug}`}",
  "missing-hub-link-template",
  "Glossary hub is missing the glossary child-link template.",
);
if (glossaryEntries.length === 0) {
  issues.push({ code: "empty-seo-family", message: "Glossary catalog is unexpectedly empty." });
}

const updatesHub = read("src/app/resources/updates/page.tsx");
requireSignal(
  updatesHub,
  "regulatoryUpdates",
  "missing-family-map",
  "Regulatory updates hub must import the update catalog.",
);
requireSignal(
  updatesHub,
  "updates.map",
  "missing-family-map",
  "Regulatory updates hub must render the update catalog.",
);
requireSignal(
  updatesHub,
  "href={`/resources/updates/${update.slug}`}",
  "missing-hub-link-template",
  "Regulatory updates hub is missing the child-link template.",
);
if (regulatoryUpdates.length === 0) {
  issues.push({ code: "empty-seo-family", message: "Regulatory update catalog is unexpectedly empty." });
}

if (PUBLISHABLE_CUSTOMER_STORIES.length > 0) {
  const customerHub = read("src/app/customers/page.tsx");
  requireSignal(
    customerHub,
    "PUBLISHABLE_CUSTOMER_STORIES",
    "missing-family-map",
    "Customer stories hub must use the approved public story collection.",
  );
  requireSignal(
    customerHub,
    "approvedStories.map",
    "missing-family-map",
    "Customer stories hub must render every approved story.",
  );
  requireSignal(
    customerHub,
    "href={`/customers/${story.slug}`}",
    "missing-hub-link-template",
    "Customer stories hub is missing the child-link template.",
  );
}

if (issues.length > 0) {
  console.error(`SEO internal-link audit failed with ${issues.length} issue(s):`);
  for (const issue of issues) console.error(`- [${issue.code}] ${issue.message}`);
  process.exitCode = 1;
} else {
  const authorityChildren =
    resourcePages.length +
    resourceWave2.length +
    resourceWave3.length +
    resourceWave14.length +
    resourceWave16.length +
    industryPages.length +
    industryWave2.length +
    industryWave6.length +
    compliancePages.length +
    complianceWave3.length +
    integrationWave6.length +
    Object.keys(CALCULATORS).length +
    glossaryEntries.length +
    regulatoryUpdates.length +
    4 +
    PUBLISHABLE_CUSTOMER_STORIES.length;

  console.log("SEO internal-link audit passed.");
  console.log(`Indexable child routes checked for hub discovery: ${authorityChildren}`);
}

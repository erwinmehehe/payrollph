import { existsSync, readFileSync } from "node:fs";
import {
  approvedCustomerSitemapEntries,
  calculatorSitemapEntries,
  complianceSitemapEntries,
  developerSitemapEntries,
  glossarySitemapEntries,
  industrySitemapEntries,
  pagesSitemapEntries,
  productSitemapEntries,
  resourceSitemapEntries,
} from "../src/lib/sitemap-data";

type Issue = { code: string; message: string };

const sitemapEntries = [
  ...pagesSitemapEntries,
  ...productSitemapEntries,
  ...complianceSitemapEntries,
  ...industrySitemapEntries,
  ...resourceSitemapEntries,
  ...calculatorSitemapEntries,
  ...glossarySitemapEntries,
  ...developerSitemapEntries,
  ...approvedCustomerSitemapEntries(),
];

const issues: Issue[] = [];

function routeFile(path: string) {
  if (path === "/") return "src/app/page.tsx";
  if (path.startsWith("/resources/updates/")) return "src/app/resources/updates/[slug]/page.tsx";
  if (path.startsWith("/resources/") && path !== "/resources/updates") return "src/app/resources/[slug]/page.tsx";
  if (path.startsWith("/compliance/")) return "src/app/compliance/[slug]/page.tsx";
  if (path === "/industries/bpo") return "src/app/industries/bpo/page.tsx";
  if (path.startsWith("/industries/")) return "src/app/industries/[slug]/page.tsx";
  if (path.startsWith("/integrations/")) return "src/app/integrations/[slug]/page.tsx";
  if (path.startsWith("/calculators/")) return "src/app/calculators/[slug]/page.tsx";
  if (path.startsWith("/glossary/")) return "src/app/glossary/[slug]/page.tsx";
  if (path.startsWith("/developers/")) return "src/app/developers/[slug]/page.tsx";
  if (path.startsWith("/customers/")) return "src/app/customers/[slug]/page.tsx";
  return `src/app${path}/page.tsx`;
}

for (const entry of sitemapEntries) {
  const file = routeFile(entry.path);

  if (!existsSync(file)) {
    issues.push({
      code: "sitemap-route-missing-page",
      message: `${entry.path} is in sitemap data but ${file} does not exist.`,
    });
    continue;
  }

  const content = readFileSync(file, "utf8");
  const hasMetadata = content.includes("export const metadata") || content.includes("generateMetadata");
  const hasTitle = content.includes("title:");
  const hasDescription = content.includes("description:");
  const hasCanonical = content.includes("alternates") && content.includes("canonical:");

  if (!hasMetadata) {
    issues.push({
      code: "missing-metadata",
      message: `${entry.path} maps to ${file} but does not export metadata or generateMetadata.`,
    });
  }
  if (!hasTitle) {
    issues.push({
      code: "missing-title",
      message: `${entry.path} maps to ${file} but no title metadata contract was found.`,
    });
  }
  if (!hasDescription) {
    issues.push({
      code: "missing-description",
      message: `${entry.path} maps to ${file} but no description metadata contract was found.`,
    });
  }
  if (!hasCanonical) {
    issues.push({
      code: "missing-canonical",
      message: `${entry.path} maps to ${file} but no canonical metadata contract was found.`,
    });
  }

  const explicitNoindex = content.includes("robots: { index: false");
  const explicitIndex = content.includes("robots: { index: true");
  if (explicitNoindex && !explicitIndex) {
    issues.push({
      code: "sitemap-noindex-conflict",
      message: `${entry.path} is in sitemap data but ${file} is explicitly noindex.`,
    });
  }
}

const publicPaths = new Set(sitemapEntries.map((entry) => entry.path));
const noindexRoutes = [
  "/login",
  "/signup",
  "/setup",
  "/invite",
  "/reset-password",
  "/verify-email",
];

for (const path of noindexRoutes) {
  if (publicPaths.has(path)) {
    issues.push({
      code: "private-route-in-sitemap",
      message: `${path} must not appear in public sitemap data.`,
    });
  }

  const file = routeFile(path);
  if (!existsSync(file)) {
    issues.push({
      code: "private-route-missing",
      message: `Expected private route page ${file} for ${path}.`,
    });
    continue;
  }

  const content = readFileSync(file, "utf8");
  if (!content.includes("robots: { index: false")) {
    issues.push({
      code: "private-route-not-noindex",
      message: `${path} must explicitly declare noindex metadata.`,
    });
  }
}

for (const path of ["/app", "/workspace"]) {
  if (publicPaths.has(path)) {
    issues.push({
      code: "application-route-in-sitemap",
      message: `${path} must not appear in public sitemap data.`,
    });
  }
}

if (issues.length > 0) {
  console.error(`SEO route audit failed with ${issues.length} issue(s):`);
  for (const issue of issues) {
    console.error(`- [${issue.code}] ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("SEO route audit passed.");
  console.log(`Public sitemap routes checked: ${sitemapEntries.length}`);
  console.log(`Explicit noindex routes checked: ${noindexRoutes.length}`);
}

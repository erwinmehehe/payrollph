import { PUBLIC_SITE_URL } from "@/lib/site-url";

type Crumb = { name: string; path: string };

type StructuredDataProps = {
  breadcrumbs?: Crumb[];
  article?: {
    headline: string;
    description: string;
    path: string;
    dateModified?: string;
    datePublished?: string;
  };
  webApplication?: {
    name: string;
    description: string;
    path: string;
  };
  service?: {
    name: string;
    description: string;
    path: string;
  };
  definedTerm?: {
    name: string;
    description: string;
    path: string;
  };
};

function absolute(path: string) {
  return new URL(path, `${PUBLIC_SITE_URL}/`).toString();
}

export function StructuredData({ breadcrumbs, article, webApplication, service, definedTerm }: StructuredDataProps) {
  const graph: Record<string, unknown>[] = [];

  if (breadcrumbs?.length) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: absolute(crumb.path),
      })),
    });
  }

  if (article) {
    graph.push({
      "@type": "Article",
      headline: article.headline,
      description: article.description,
      mainEntityOfPage: absolute(article.path),
      datePublished: article.datePublished,
      dateModified: article.dateModified,
      author: { "@type": "Organization", name: "Linaw", url: PUBLIC_SITE_URL },
      publisher: { "@type": "Organization", name: "Linaw", url: PUBLIC_SITE_URL },
      inLanguage: "en-PH",
    });
  }

  if (webApplication) {
    graph.push({
      "@type": "WebApplication",
      name: webApplication.name,
      description: webApplication.description,
      url: absolute(webApplication.path),
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      inLanguage: "en-PH",
    });
  }

  if (service) {
    graph.push({
      "@type": "Service",
      name: service.name,
      description: service.description,
      url: absolute(service.path),
      provider: { "@type": "Organization", name: "Linaw", url: PUBLIC_SITE_URL },
      areaServed: { "@type": "Country", name: "Philippines" },
    });
  }

  if (definedTerm) {
    graph.push({
      "@type": "DefinedTerm",
      name: definedTerm.name,
      description: definedTerm.description,
      url: absolute(definedTerm.path),
      inDefinedTermSet: absolute("/glossary"),
      inLanguage: "en-PH",
    });
  }

  if (!graph.length) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c"),
      }}
    />
  );
}

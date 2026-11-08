import { HELP_ARTICLES } from "./help-center-content";

/**
 * A deliberate local Help Center link activation must open its public guide
 * whether the URL has a new, unchanged or missing fragment. Next Link may use
 * pushState, which does not always trigger a native hashchange.
 *
 * Normal navigation is not prevented; modifier clicks and external targets
 * keep their standard behavior.
 */
export function clickedHelpGuideSlug(input: {
  href: string | null;
  pathname: string;
  primaryUnmodified: boolean;
}): string | null {
  if (!input.primaryUnmodified || !/^\/help\/?$/.test(input.pathname) ||
      !input.href?.startsWith("/help#")) return null;

  const slug = input.href.slice("/help#".length);
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  return HELP_ARTICLES.some((article) => article.slug === slug) ? slug : null;
}

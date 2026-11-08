import { HELP_ARTICLES } from "./help-center-content";

/** Identify an unchanged same-page guide hash. Different hashes rely on the
 * native/Next.js navigation event; invalid or modified activations are ignored.
 */
export function repeatedHelpGuideSlug(input: {
  href: string | null;
  pathname: string;
  currentHash: string;
  primaryUnmodified: boolean;
}): string | null {
  if (!input.primaryUnmodified || !/^\/help\/?$/.test(input.pathname) ||
      !input.href?.startsWith("/help#")) return null;

  const slug = input.href.slice("/help#".length);
  if (!slug || input.currentHash !== "#" + slug) return null;
  return HELP_ARTICLES.some((article) => article.slug === slug) ? slug : null;
}

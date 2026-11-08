"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Search, X } from "lucide-react";
import { HELP_AUDIENCES, HELP_ARTICLES, searchHelpArticles, type HelpAudience } from "@/lib/help-center-content";
import { repeatedHelpGuideSlug } from "@/lib/help-guide-navigation";

const QUICK_GUIDES = [
  { slug: "find-released-payslips", label: "Download a payslip" },
  { slug: "request-leave", label: "Request leave" },
  { slug: "review-attendance", label: "Review attendance" },
  { slug: "new-employee-checklists", label: "Onboard a new hire" },
  { slug: "first-payroll-preparation", label: "Prepare first payroll" },
] as const;

export function HelpCenterSearch() {
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<HelpAudience | "All">("All");
  const articles = useMemo(() => searchHelpArticles(query, audience), [query, audience]);
  const [guideNavigation, setGuideNavigation] = useState<{ slug: string; revision: number } | null>(null);

  const openGuide = useCallback((slug: string) => {
    if (!HELP_ARTICLES.some((article) => article.slug === slug)) return;
    // All these guides are public; reset the local role/search view so the
    // target is present before opening its existing step-by-step content.
    setQuery("");
    setAudience("All");
    setGuideNavigation((current) => ({ slug, revision: (current?.revision ?? 0) + 1 }));
  }, []);

  // Employee self-service links land on /help#guide-slug. Expand the guide
  // after hydration so the user can read steps rather than a closed card.
  useEffect(() => {
    function openHashGuide() {
      const slug = window.location.hash.slice(1);
      if (HELP_ARTICLES.some((article) => article.slug === slug)) openGuide(slug);
    }
    openHashGuide();
    window.addEventListener("hashchange", openHashGuide);
    return () => window.removeEventListener("hashchange", openHashGuide);
  }, [openGuide]);

  // React/Next Link handles navigation in the bubbling phase, but clicking a
  // link to the *existing* hash does not emit hashchange. The capture listener
  // re-opens a manually collapsed guide without interrupting normal routing.
  useEffect(() => {
    function reopenSameHashGuide(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href^="/help#"]');
      const slug = repeatedHelpGuideSlug({
        href: link?.getAttribute("href") ?? null,
        pathname: window.location.pathname,
        currentHash: window.location.hash,
        primaryUnmodified: event.button === 0 && !event.metaKey &&
          !event.ctrlKey && !event.shiftKey && !event.altKey &&
          (!link?.target || link.target === "_self"),
      });
      if (slug) openGuide(slug);
    }
    document.addEventListener("click", reopenSameHashGuide, true);
    return () => document.removeEventListener("click", reopenSameHashGuide, true);
  }, [openGuide]);
  useEffect(() => {
    if (!guideNavigation) return;
    const article = document.getElementById(guideNavigation.slug);
    if (!article) return;
    const details = article.querySelector("details");
    if (details) details.open = true;
    article.scrollIntoView({ block: "start", behavior: "auto" });
    article.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  }, [guideNavigation, articles]);

  return (
    <section aria-labelledby="help-articles-heading" className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0877ff]">Browse help topics</p>
          <h2 id="help-articles-heading" className="font-display mt-2 text-3xl font-semibold tracking-tight">Answers by task and role</h2>
        </div>
        <span className="text-sm text-slate-600" role="status" aria-live="polite">
          {articles.length} {articles.length === 1 ? "guide" : "guides"} found
        </span>
      </div>
      <div className="mt-7 flex max-w-[730px] items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-blue-600">
        <Search size={20} aria-hidden="true" className="text-slate-500" />
        <label className="sr-only" htmlFor="help-query">Search help topics</label>
        <input id="help-query" type="search" autoComplete="off"
          className="min-w-0 flex-1 border-0 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-500"
          placeholder="Search payslips, leave, onboarding..."
          value={query} onChange={(event) => setQuery(event.target.value)}
        />
        {query && <button type="button" className="rounded p-1 text-sm text-slate-600 hover:text-slate-900" onClick={() => setQuery("")} aria-label="Clear search"><X size={18} /></button>}
      </div>
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter help topics by role">
        {(["All", ...HELP_AUDIENCES] as const).map((item) => (
          <button key={item} type="button" aria-pressed={audience === item} onClick={() => setAudience(item)}
            className={"min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 " +
              (audience === item ? "border-[#0877ff] bg-[#0877ff] text-white" : "border-slate-300 bg-white text-slate-700 hover:border-blue-500")}>
            {item === "All" ? "All roles" : item}
          </button>
        ))}
      </div>
      <nav aria-label="Popular help tasks" className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-slate-800">Go straight to a step-by-step guide</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {QUICK_GUIDES.map((guide) => (
            <button key={guide.slug} type="button" onClick={() => openGuide(guide.slug)}
              className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-[#0868dc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
              {guide.label}<ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </nav>
      {articles.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-7" role="status">
          <h3 className="text-lg font-semibold">No matching guides</h3>
          <p className="mt-2 text-sm text-slate-600">Try a shorter term or choose All roles.</p>
          <button type="button" onClick={() => { setQuery(""); setAudience("All"); }}
            className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Reset filters</button>
        </div>
      ) : (
        <div className="mt-8 grid items-start gap-4 md:grid-cols-2">
          {articles.map((article) => (
            <article id={article.slug} key={article.slug} className="scroll-mt-24 rounded-[22px] border border-[#E4E6F0] bg-[#FAFBFD] p-5 sm:p-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#445373]">
                <BookOpen size={15} aria-hidden="true" />
                <span>{article.category}</span><span aria-hidden="true">·</span><span>{article.audience}</span>
              </div>
              <h3 className="font-display mt-3 text-xl font-semibold leading-snug">{article.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#555C76]">{article.summary}</p>
              <details className="group mt-5 border-t border-slate-200 pt-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#0868dc] focus-visible:outline-2 focus-visible:outline-blue-700">Show step-by-step guide</summary>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
                  {article.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
                {article.note && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-slate-800">{article.note}</p>}
                <Link href={article.related.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0868dc]">
                  {article.related.label} <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Search, X } from "lucide-react";
import { HELP_AUDIENCES, searchHelpArticles, type HelpAudience } from "@/lib/help-center-content";

export function HelpCenterSearch() {
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<HelpAudience | "All">("All");
  const articles = useMemo(() => searchHelpArticles(query, audience), [query, audience]);

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

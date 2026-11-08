import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { HELP_ARTICLES } from "@/lib/help-center-content";
import { HELP_ONBOARDING_PATHS } from "@/lib/help-onboarding-paths";

/**
 * Public server-rendered guide links. The existing HelpCenterSearch component
 * opens the target article's details from the /help#slug hash.
 */
export function HelpOnboardingPaths() {
  return (
    <section aria-labelledby="role-onboarding-heading" className="border-b border-slate-200 bg-white py-12 sm:py-16">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#0877ff]">Start by role</p>
        <h2 id="role-onboarding-heading" className="font-display mt-2 text-3xl font-semibold tracking-tight">
          Your first steps in Linaw
        </h2>
        <p className="mt-3 max-w-[780px] text-sm leading-relaxed text-slate-700">
          Choose your role, then follow the existing step-by-step guides. These are instructions,
          not live approvals, payroll calculations or access grants.
        </p>
        <div className="mt-8 grid items-start gap-4 lg:grid-cols-2">
          {HELP_ONBOARDING_PATHS.map((path) => (
            <article key={path.audience} className="rounded-[22px] border border-[#E4E6F0] bg-[#FAFBFD] p-5 sm:p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.09em] text-[#445373]">
                <BookOpen size={16} aria-hidden="true" /> Role guide
              </div>
              <h3 className="font-display mt-3 text-xl font-semibold text-slate-900">{path.audience}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{path.description}</p>
              <ol className="mt-5 space-y-3" aria-label={path.audience + " starting steps"}>
                {path.steps.map((step, index) => {
                  const guide = HELP_ARTICLES.find((article) => article.slug === step.guideSlug);
                  if (!guide) return null;
                  return (
                    <li key={step.guideSlug} className="flex gap-3 border-t border-slate-200 pt-3">
                      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#E8F1FF] text-xs font-bold text-[#075AC2]">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-slate-700">{step.purpose}</p>
                        <Link href={"/help#" + step.guideSlug}
                          className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#0868dc] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                          {guide.title} <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

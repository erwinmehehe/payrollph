import Link from "next/link";
import {
  buildHcmNavigation,
  type HcmNavigationOptions,
} from "@/lib/hcm-context-navigation";

/** Accessible, read-only navigation for an already-authorized HCM page. */
export function HcmContextNavigation(props: HcmNavigationOptions & { simpleHome?: boolean }) {
  const links = buildHcmNavigation(props).filter((link) =>
    !props.simpleHome || !["processMonitor", "orgExplorer", "actionCenter"].includes(link.id)
  );
  if (links.length === 0) return null;

  return (
    <nav aria-label="HCM workspace navigation"
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="shrink-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
            Linaw · HCM
          </p>
          <p className="text-xs text-slate-500">
            Selected employer <span className="font-semibold text-slate-800">#{props.organizationId}</span>
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="HCM destinations">
          {links.map((link) => (
            <li key={link.id}>
              <Link href={link.href} aria-current={link.current ? "page" : undefined}
                className={
                  "inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-semibold outline-offset-2 " +
                  "focus-visible:ring-2 focus-visible:ring-emerald-700 " +
                  (link.current
                    ? "bg-emerald-900 text-white"
                    : "text-slate-700 hover:bg-slate-100 hover:text-emerald-900")
                }>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

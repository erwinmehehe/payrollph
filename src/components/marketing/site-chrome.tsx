"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { LinawMark } from "@/components/linaw-mark";
import { PUBLIC_FOOTER_GROUPS, PUBLIC_PRIMARY_LINKS } from "./public-navigation";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center [&_.linaw-mark]:block [&_.linaw-mark]:h-full [&_.linaw-mark]:w-full" style={{ width:size, height:size }} aria-hidden="true">
      <LinawMark />
    </span>
  );
}

export function SiteNav() {
  const [stuck, setStuck] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header
        className={`sticky top-0 z-50 border-b transition-all duration-300 ${
          stuck
            ? "border-[#E8EAF3] bg-white/92 shadow-[0_8px_24px_-18px_rgba(16,18,38,.28)] backdrop-blur-xl"
            : "border-transparent bg-white/85 backdrop-blur-lg"
        }`}
      >
        <nav className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between gap-5 px-5 sm:px-8" aria-label="Primary">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label="Linaw home">
            <span className="transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">
              <BrandMark />
            </span>
            <span className="leading-none">
              <span className="font-display block text-[19px] font-semibold tracking-tight text-[#0B0D1A]">linaw</span>
              <span className="mt-1 block text-[8.5px] font-bold uppercase tracking-[0.18em] text-[#7C82A1]">Philippine Payroll</span>
            </span>
          </Link>

          <div className="hidden min-w-0 items-center justify-center gap-0.5 xl:flex">
            {PUBLIC_PRIMARY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-[#2B2F45] transition-colors hover:bg-[#F1F2F8] hover:text-[#0B0D1A]"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden shrink-0 items-center gap-2 xl:flex">
            <Link href="/login" className="rounded-full px-4 py-2.5 text-[14px] font-semibold text-[#2B2F45] hover:bg-[#F1F2F8]">
              Sign in
            </Link>
            <Link
              href="/book-demo"
              className="inline-flex items-center rounded-[10px] border border-[#d4e3f9] bg-[#eef5ff] px-4 py-2.5 text-[14px] font-semibold text-[#1768c8] transition-all hover:border-[#aecdf3] hover:bg-[#e2efff]"
            >
              Request a demo
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setDrawer((current) => !current)}
            aria-expanded={drawer}
            aria-label={drawer ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E8EAF3] bg-white text-[#0B0D1A] xl:hidden"
          >
            {drawer ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>

        <div className={`overflow-hidden bg-white transition-all duration-300 xl:hidden ${drawer ? "max-h-[620px] border-t border-[#E8EAF3] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="mx-auto max-w-[1240px] px-5 pb-6 pt-3 sm:px-8">
            <div className="grid gap-1 sm:grid-cols-2">
              {PUBLIC_PRIMARY_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setDrawer(false)}
                  className="rounded-xl px-4 py-3 text-[15px] font-semibold text-[#2B2F45] hover:bg-[#F6F7FB]"
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="mt-3 flex gap-2 border-t border-[#E8EAF3] pt-4">
              <Link href="/login" onClick={() => setDrawer(false)} className="flex-1 rounded-full border border-[#E8EAF3] px-5 py-3 text-center text-[14px] font-semibold">
                Sign in
              </Link>
              <Link href="/book-demo" onClick={() => setDrawer(false)} className="flex-1 rounded-[10px] border border-[#d4e3f9] bg-[#eef5ff] px-5 py-3 text-center text-[14px] font-semibold text-[#1768c8]">
                Request a demo
              </Link>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[#EDEFF7] bg-[#FAFBFD]">
      <div className="mx-auto max-w-[1240px] px-5 pb-10 pt-14 sm:px-8 sm:pt-16">
        <div className="grid gap-10 md:grid-cols-[1.45fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-3" aria-label="Linaw home">
              <BrandMark size={40} />
              <span className="leading-none">
                <span className="font-display block text-[22px] font-semibold tracking-tight text-[#0B0D1A]">linaw</span>
                <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.18em] text-[#7C82A1]">Philippine Payroll</span>
              </span>
            </Link>
            <p className="mt-5 max-w-[340px] text-[14px] leading-relaxed text-[#5B6080]">
              Philippine payroll software for teams that want every run, approval and peso to be traceable.
            </p>
          </div>

          {PUBLIC_FOOTER_GROUPS.map((group) => (
            <nav key={group.label} aria-label={group.label}>
              <p className="text-[12px] font-bold uppercase tracking-[0.13em] text-[#8B90AA]">{group.label}</p>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-[14px] font-medium text-[#2B2F45] transition-colors hover:text-[#1768c8]">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-[#E2E4F0] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] font-medium text-[#5B6080]">Linaw · Philippine payroll software.</p>
          <p className="text-[12.5px] text-[#8B90AA]">Government worksheet output is labelled DRAFT until validated.</p>
        </div>
      </div>
    </footer>
  );
}

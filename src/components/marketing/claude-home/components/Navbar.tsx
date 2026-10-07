import { useEffect, useState } from "react";
import { Menu, ShieldCheck, X } from "lucide-react";
import { cn } from "../utils/cn";
import { PUBLIC_PRIMARY_LINKS } from "@/components/marketing/public-navigation";

const links = PUBLIC_PRIMARY_LINKS;

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-[#0B0D1A] focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled ? "bg-white/85 shadow-[0_1px_0_#E8EAF3,0_8px_24px_-12px_rgba(16,18,38,0.15)] backdrop-blur-xl" : "bg-white/60 backdrop-blur-sm"
        )}
      >
        <nav aria-label="Primary" className="mx-auto flex h-[68px] max-w-[1200px] items-center justify-between px-5 sm:px-8">
          <a href="/" className="group flex items-center gap-2.5" aria-label="Linaw home">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#102A4C] p-0.5 transition-transform duration-300 group-hover:rotate-[-4deg] group-hover:scale-105">
              <ShieldCheck className="h-[18px] w-[18px] text-white" aria-hidden />
            </span>
            <span className="leading-none">
              <span className="font-display block text-[18px] font-extrabold tracking-tight text-[#102A4C]">linaw</span>
              <span className="block text-[8px] font-bold uppercase tracking-[0.15em] text-[#7C8EA0]">Philippine Payroll</span>
            </span>
          </a>

          <div className="hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="rounded-full px-4 py-2 text-[14px] font-medium text-[#2B2F45] transition-colors hover:bg-[#F1F2F8] hover:text-[#0B0D1A]"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <a
              href="/login"
              className="rounded-full px-4 py-2 text-[14px] font-semibold text-[#2B2F45] transition-colors hover:bg-[#F1F2F8]"
            >
              Sign in
            </a>
            <a
              href="/book-demo"
              className="nav-start-cta inline-flex items-center rounded-[10px] border border-[#D9D9FF] bg-[#F5F5FF] px-4 py-2.5 text-[14px] font-semibold text-[#4A4AE0] transition-all hover:border-[#C5C5FF] hover:bg-[#ECECFF]"
            >
              Request a demo
            </a>
          </div>

          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#E8EAF3] bg-white text-[#0B0D1A] lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>

        <div
          className={cn(
            "overflow-hidden border-b border-[#E8EAF3] bg-white/95 backdrop-blur-xl transition-all duration-300 lg:hidden",
            open ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="space-y-1 px-5 pb-6 pt-2">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block rounded-xl px-4 py-3 text-[15px] font-semibold text-[#2B2F45] hover:bg-[#F6F7FB]"
              >
                {l.label}
              </a>
            ))}
            <div className="flex gap-2 pt-3">
              <a
                href="/login"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-full border border-[#E8EAF3] px-5 py-3 text-center text-[14px] font-semibold"
              >
                Sign in
              </a>
              <a
                href="/book-demo"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-[10px] border border-[#D9D9FF] bg-[#F5F5FF] px-5 py-3 text-center text-[14px] font-semibold text-[#4A4AE0]"
              >
                Request a demo
              </a>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}

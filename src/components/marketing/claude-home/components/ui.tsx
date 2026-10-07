import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../utils/cn";

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("reveal", className)}
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  align = "left",
}: {
  title: ReactNode;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center")}>
      <Reveal>
        <h2 className="font-display text-balance text-4xl font-extrabold leading-[1.05] text-[#0B0D1A] sm:text-5xl lg:text-[3.4rem]">
          {title}
        </h2>
      </Reveal>
      {description && (
        <Reveal delay={100}>
          <p className="mt-5 max-w-2xl text-pretty text-[17px] leading-relaxed text-[#5B6080]">{description}</p>
        </Reveal>
      )}
    </div>
  );
}

export function Avatar({ initials, bg }: { initials: string; bg: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white", bg)}
    >
      {initials}
    </span>
  );
}

export function CheckItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[14.5px] leading-relaxed text-[#2B2F45]">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e5f8f2]">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2.5 6.2L4.8 8.5L9.5 3.5" stroke="#00886e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {children}
    </li>
  );
}

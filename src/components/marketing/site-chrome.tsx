"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { LinawMark } from "@/components/linaw-mark";
import { PUBLIC_FOOTER_GROUPS } from "./public-navigation";
import "./public-pages.css";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span className="ln-mark" style={{ width: size, height: size }}>
      <LinawMark />
    </span>
  );
}

const menus = [
  {
    label: "Product",
    intro: "People, time, and pay. Connected.",
    links: PUBLIC_FOOTER_GROUPS[0].links.filter(
      (link) =>
        ![
          "/#product",
          "/pricing",
          "/developers",
          "/payroll-outsourcing",
        ].includes(link.href),
    ),
  },
  {
    label: "Resources",
    intro: "Make your next payroll decision clearer.",
    links: PUBLIC_FOOTER_GROUPS[1].links.slice(0, 7),
  },
  {
    label: "Company",
    intro: "Get to know Linaw and the controls behind it.",
    links: PUBLIC_FOOTER_GROUPS[2].links.slice(0, 7),
  },
];

function Brand() {
  return (
    <Link href="/" className="ln-brand" aria-label="Linaw home">
      <BrandMark />
      <span>
        <strong>Linaw</strong>
        <small>PEOPLE &middot; TIME &middot; PAY</small>
      </span>
    </Link>
  );
}

export function SiteNav() {
  const [drawer, setDrawer] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const closeMenus = (event: Event) => {
      const key = event as KeyboardEvent;
      if (event.type === "keydown" && key.key !== "Escape") return;
      const outside = !header.current?.contains(event.target as Node);
      if (key.key !== "Escape" && !outside) return;
      const openMenus = header.current?.querySelectorAll<HTMLDetailsElement>("details[open]");
      if (key.key === "Escape" && !drawer && !openMenus?.length) return;
      const summary = openMenus?.[0]?.querySelector("summary");
      openMenus?.forEach((detail) => detail.removeAttribute("open"));
      if (key.key === "Escape") {
        key.preventDefault();
        setDrawer(false);
        if (drawer) toggle.current?.focus();
        else summary?.focus();
      }
      if (outside) setDrawer(false);
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, [drawer]);
  return (
    <header ref={header} className="linaw-site-nav ln-header">
      <nav className="ln-nav" aria-label="Primary">
        <Brand />
        <div className="ln-desktop">
          {menus.map((menu) => (
            <details
              key={menu.label}
              className="ln-menu"
              onToggle={(event) => {
                const current = event.currentTarget;
                if (current.open)
                  header.current
                    ?.querySelectorAll("details[open]")
                    .forEach((detail) => {
                      if (detail !== current) detail.removeAttribute("open");
                    });
              }}
            >
              <summary>
                {menu.label}
                <ChevronDown size={14} />
              </summary>
              <div className="ln-dropdown">
                <p>{menu.intro}</p>
                <div>
                  {menu.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() =>
                        header.current
                          ?.querySelectorAll("details[open]")
                          .forEach((detail) => detail.removeAttribute("open"))
                      }
                    >
                      {link.label}
                      <ArrowRight size={13} />
                    </Link>
                  ))}
                </div>
                <Link className="ln-dropdown-demo" href="/demo">
                  Explore the role-based demo <ArrowRight size={15} />
                </Link>
              </div>
            </details>
          ))}
          <Link href="/payroll-outsourcing">Outsourcing</Link>
          <Link href="/pricing">Pricing</Link>
        </div>
        <div className="ln-actions">
          <Link href="/login">Sign in</Link>
          <Link href="/demo" className="ln-demo">
            Try demo
          </Link>
          <Link href="/book-demo" className="ln-primary">
            Book a demo <ArrowRight size={15} />
          </Link>
        </div>
        <button
          ref={toggle}
          className="ln-toggle"
          type="button"
          aria-label={drawer ? "Close menu" : "Open menu"}
          aria-expanded={drawer}
          aria-controls="linaw-mobile-nav"
          onClick={() => setDrawer(!drawer)}
        >
          {drawer ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>
      {drawer && (
        <nav
          id="linaw-mobile-nav"
          className="ln-mobile"
          aria-label="Mobile primary"
        >
          {menus.map((menu) => (
            <details key={menu.label}>
              <summary>
                {menu.label}
                <ChevronDown size={16} />
              </summary>
              <div>
                {menu.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setDrawer(false)}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </details>
          ))}
          <Link href="/payroll-outsourcing">Payroll outsourcing</Link>
          <Link href="/pricing">Pricing</Link>
          <div className="ln-mobile-actions">
            <Link href="/login">Sign in</Link>
            <Link href="/demo">Try demo</Link>
            <Link href="/book-demo" className="ln-primary">
              Book a demo
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="ln-footer">
      <div className="ln-footer-top">
        <div>
          <span className="ln-eyebrow">A clearer payday starts here</span>
          <h2>
            Your people. Your time.
            <br />
            Your next payday.
          </h2>
          <p>Explore the workflow, or talk through what your team needs.</p>
        </div>
        <div className="ln-footer-cta">
          <Link href="/book-demo" className="ln-primary">
            Book a demo <ArrowRight size={16} />
          </Link>
          <Link href="/demo">
            Explore the product <ArrowRight size={16} />
          </Link>
        </div>
      </div>
      <div className="ln-footer-grid">
        <div className="ln-footer-brand">
          <Brand />
          <p>Connected payroll and people software for Philippine teams.</p>
          <Link href="/contact">
            Talk to our team <ArrowRight size={14} />
          </Link>
          <span>Built around a clearer payday.</span>
        </div>
        {PUBLIC_FOOTER_GROUPS.map((group) => (
          <nav key={group.label} aria-label={group.label}>
            <h3>
              {group.label === "Trust & access"
                ? "Company & trust"
                : group.label}
            </h3>
            <ul>
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="ln-footer-bottom">
        <span>&copy; {new Date().getFullYear()} Linaw. People, time, and pay.</span>
        <div>
          <Link href="/security">Security</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/status">System status</Link>
          <Link href="/methodology">Our methodology</Link>
        </div>
      </div>
    </footer>
  );
}

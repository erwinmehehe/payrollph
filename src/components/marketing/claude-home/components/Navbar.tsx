import { SiteNav } from "@/components/marketing/site-chrome";

export default function Navbar() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      <SiteNav />
    </>
  );
}

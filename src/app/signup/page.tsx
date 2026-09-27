import { redirect } from "next/navigation";
import { SignupForm } from "@/components/signup-form";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user && !user.demo) redirect("/");

  return (
    <main className="marketing-page" style={{ minHeight: "100vh" }}>
      <header className="marketing-nav">
        <a className="marketing-brand" href="/welcome">
          <div className="brand-mark"><span>sa</span></div>
          <strong>linaw</strong>
        </a>
        <div className="marketing-nav-actions">
          <a className="secondary-button" href="/welcome">Back to website</a>
          <a className="secondary-button" href="/book-demo">Book demo</a>
        </div>
      </header>
      <section style={{ width: "min(560px, 100%)", margin: "54px auto 80px" }}>
        <p className="eyebrow">START YOUR OWN WORKSPACE</p>
        <h1 style={{ fontSize: 36, letterSpacing: "-.045em", margin: "6px 0 10px" }}>Ready to use Linaw with your team?</h1>
        <p className="heading-copy" style={{ marginBottom: 22 }}>Leave the public sandbox behind and create an isolated company workspace for your own employees and payroll data.</p>
        <SignupForm />
      </section>
    </main>
  );
}

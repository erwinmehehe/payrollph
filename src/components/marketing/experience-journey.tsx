import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCheck,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  ShieldCheck,
  UserRoundPlus,
  UsersRound,
  WalletCards,
} from "lucide-react";

const steps = [
  { title: "Hire", detail: "Start with an authorized employee record.", href: "/hris", icon: UserRoundPlus },
  { title: "Onboard", detail: "Assign the people and documents needed.", href: "/hcm", icon: UsersRound },
  { title: "Schedule", detail: "Publish shifts with clear ownership.", href: "/workforce-management", icon: CalendarDays },
  { title: "Clock in", detail: "Capture time and flag missing punches.", href: "/time-and-attendance", icon: Clock3 },
  { title: "Approve time", detail: "Resolve exceptions before cutoff.", href: "/time-and-attendance", icon: CheckCheck },
  { title: "Run payroll", detail: "Review calculations and deductions.", href: "/small-business-payroll", icon: WalletCards },
  { title: "Review", detail: "Separate payroll preparation from checking.", href: "/demo", icon: ClipboardCheck },
  { title: "Release records", detail: "Make approved pay records available.", href: "/employee-self-service", icon: FileText },
  { title: "Filing evidence", detail: "Keep outputs and proof of next actions.", href: "/compliance", icon: FileCheck2 },
] as const;

export function ExperienceJourney() {
  return (
    <section className="linaw-experience-journey" aria-labelledby="journey-title">
      <div className="journey-heading">
        <div>
          <p className="journey-eyebrow"><ShieldCheck size={14} aria-hidden /> One connected operating journey</p>
          <h2 id="journey-title">From the first hire to the payroll record.</h2>
          <p>
            Follow the handoffs between HR, workforce management, payroll and review.
            Each step has a place in Linaw, with access determined by the person's role.
          </p>
        </div>
        <Link href="/demo" className="journey-primary">
          Explore the demo <ArrowRight size={17} aria-hidden />
        </Link>
      </div>
      <ol className="journey-track">
        {steps.map(({ title, detail, href, icon: Icon }, index) => (
          <li key={title}>
            <Link href={href} className="journey-step">
              <span className="journey-step-top">
                <span className="journey-step-icon"><Icon size={20} aria-hidden /></span>
                <span className="journey-step-count">{String(index + 1).padStart(2, "0")}</span>
              </span>
              <strong>{title}</strong>
              <span className="journey-step-detail">{detail}</span>
              <span className="journey-step-link">Explore step <ArrowRight size={14} aria-hidden /></span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="journey-footnote">
        Illustrative product journey. Live approvals and releases remain permission-gated;
        prepared filing data is not proof of government acceptance.
      </p>
    </section>
  );
}

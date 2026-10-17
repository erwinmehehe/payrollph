import { redirect } from "next/navigation";

// Old trial links remain usable, but no second registration funnel exists.
export default function TrialPage() {
  redirect("/signup");
}

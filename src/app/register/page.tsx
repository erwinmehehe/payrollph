import { redirect } from "next/navigation";

// Support the familiar /register URL without maintaining a second account
// creation implementation. /signup decides whether self-service is ready
// or the company must first request invitation-based access.
export default function RegisterPage() {
  redirect("/signup");
}

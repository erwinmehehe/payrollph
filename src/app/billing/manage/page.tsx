import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Keep the selected employer through billing navigation. An absent selector
 * retains legacy primary-company behavior; an invalid or duplicated selector
 * must never silently switch the user to a different company's billing.
 *
 * The destination independently enforces active membership, billing roles,
 * custom permissions and company-wide scope before querying employer data.
 */
export default async function ManageBilling({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const { organizationId: selected } = await searchParams;
  if (selected === undefined) redirect("/billing/setup");
  if (typeof selected !== "string" || !/^[1-9]\d*$/.test(selected)) notFound();
  const organizationId = Number(selected);
  if (!Number.isSafeInteger(organizationId)) notFound();
  redirect(`/billing/setup?organizationId=${organizationId}`);
}

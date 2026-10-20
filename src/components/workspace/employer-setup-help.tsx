"use client";

export function EmployerSetupHelp({ onOpen, entitiesPage = false }: {
  onOpen?: () => void;
  entitiesPage?: boolean;
}) {
  return <section aria-label="Legal employer setup" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-slate-800">
    <h2 className="font-semibold">{entitiesPage ? "Manage your legal employer" : "Set up a legal employer first"}</h2>
    <p className="mt-2">{entitiesPage
      ? "Multi-entity management is not enabled. Your current legal employer is managed in Enterprise → Legal employers."
      : "A payroll run must belong to an active legal employer. Open Legal employers, review your company details, then return to Payroll."}</p>
    {onOpen
      ? <button type="button" className="secondary-button mt-3" onClick={onOpen}>Open employer setup</button>
      : <p className="mt-2">Ask a company-wide owner or administrator to complete employer setup.</p>}
    <p className="mt-2">Employer setup does not approve payroll or authorize a bank payout.</p>
  </section>;
}

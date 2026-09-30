/**
 * Names of banks, e-wallets, accounting platforms and government forms the
 * product genuinely generates files or disbursements for, see the workspace
 * exports view and src/lib/paymongo-disbursements.ts. No customer names
 * appear here, this project does not publish logos or quotes it cannot stand
 * behind.
 */
const TARGETS = [
  "BDO",
  "BPI",
  "UnionBank",
  "GCash",
  "PayMongo",
  "Xero",
  "QuickBooks",
  "SSS R-3",
  "PhilHealth RF-1",
  "Pag-IBIG MCRF",
  "BIR 1601-C",
  "Alphalist 2316",
];

export function TrustStrip() {
  const doubled = [...TARGETS, ...TARGETS];
  return (
    <section className="trust-strip" aria-label="Export and disbursement targets">
      <p>Generates files for the banks, ledgers and agencies you already use</p>
      <div className="trust-marquee-mask">
        <div className="trust-marquee" aria-hidden>
          {doubled.map((name, index) => (
            <span key={`${name}-${index}`}>{name}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

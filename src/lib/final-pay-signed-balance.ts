import { storedMoneyCentavos, verifiedPesosFromCentavos } from "./stored-money-centavos";
/** Reconciliation balance, NOT payable cash or proof of collectible employee debt. */
export function finalPaySignedBalance(record: {
  grossFinalPay: unknown; taxAdjustment: unknown;
  finalStatutoryDeductions: unknown; loanDeductions: unknown;
}) {
  const gross = storedMoneyCentavos(record.grossFinalPay), tax = storedMoneyCentavos(record.taxAdjustment);
  const statutory = storedMoneyCentavos(record.finalStatutoryDeductions), loans = storedMoneyCentavos(record.loanDeductions);
  if (gross === null || tax === null || statutory === null || loans === null || gross < 0 || statutory < 0 || loans < 0) return null;
  const result = gross + tax - statutory - loans;
  return verifiedPesosFromCentavos(result);
}

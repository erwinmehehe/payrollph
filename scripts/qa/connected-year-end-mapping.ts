import assert from "node:assert/strict";
import { CERTIFICATE_ITEMS } from "../../src/lib/bir-2316-certificate";
/** Explicit fictional reviewer mapping, not a production category classifier.
 * Employee contributions appear in exempt item 36 and must be removed from
 * taxable categories once. This fixture allocates to BASIC, then commission. */
export function mapConnectedCompensation(input: { gross: number; basic: number; benefit: number; commission: number; contributions: number }) {
  for (const amount of Object.values(input)) assert.ok(Number.isSafeInteger(amount) && amount >= 0);
  const { gross, basic, benefit, commission, contributions } = input;
  assert.ok(Number.isSafeInteger(basic + benefit + commission));
  const premiums = gross - basic - benefit - commission;
  assert.ok(premiums >= 0 && contributions <= basic + commission, "Unsupported fictional source mapping");
  const basicDeduction = Math.min(basic, contributions);
  const commissionDeduction = contributions - basicDeduction;
  const money = (c: number) => (c / 100).toFixed(2);
  return { ...Object.fromEntries(CERTIFICATE_ITEMS.map(k => [k, "0.00"])),
    "34": money(benefit), "36": money(contributions), "39": money(basic - basicDeduction),
    "45": money(commission - commissionDeduction), "51B": money(premiums) };
}

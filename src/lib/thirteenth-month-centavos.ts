import { storedMoneyCentavos } from "./stored-money-centavos";
/** Round 1/12 of earned basic cents, half-up, without a binary peso division.
 * Source must already be a nonnegative centavo amount; never invent missing pay.
 */
export function thirteenthMonthFromCentavos(basic: number) {
  const cents = storedMoneyCentavos(basic);
  // Beyond this bound a peso Number is an unsuitable source for centavo
  // arithmetic; fail closed rather than pretend a lost source cent is exact.
  if (cents === null || cents < 0 || basic > 1_000_000_000_000) throw new Error("THIRTEENTH_BASIC_CENTAVOS_INVALID");
  return (Math.floor(cents / 12) + (cents % 12 >= 6 ? 1 : 0)) / 100;
}

import type { DecisionSource } from "./hcm-manager-decision-contract";

/** Accessible, horizontal roving tab selection for the read-only manager inbox.
 * The caller passes its actual rendered source order; there is no second menu.
 * Returning null leaves standard Tab, form keys and vertical scrolling alone.
 */
export function nextManagerDecisionTab(
  current: DecisionSource,
  key: string,
  order: readonly DecisionSource[],
): DecisionSource | null {
  if (!order.length || new Set(order).size !== order.length) return null;
  const index = order.indexOf(current);
  if (index < 0) return null;
  switch (key) {
    case "ArrowRight":
      return order[(index + 1) % order.length];
    case "ArrowLeft":
      return order[(index + order.length - 1) % order.length];
    case "Home":
      return order[0];
    case "End":
      return order[order.length - 1];
    default:
      return null;
  }
}

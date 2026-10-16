/**
 * Focus existing read-only Employee 360 source sections from their overview.
 * Sections are often <section>/<div> and cannot receive focus by default.
 * Keep a temporary programmatic focus target for keyboard/screen-reader users,
 * then restore its original tab order on blur.
 */
export function focusEmployee360Section(
  target: HTMLElement,
  reducedMotion: boolean,
): void {
  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "start",
  });
}

/**
 * Deterministic 375px mobile viewport geometry contract.
 * No baseline screenshots with ephemeral timestamps or private records:
 * capture synthetic screenshots as artifacts and fail for measurable UI drift.
 */
/** Staff workspace and employee ESS render different mobile navigation.
 * Resolve the actual native opener for each layout; never fake its geometry.
 */
export function mobileNavOpenerSelector(role) {
  return role === "employee"
    ? '.employee-mobile-nav button[aria-label="More employee pages"]'
    : '.app-main button[aria-label="Open navigation"]';
}

export function mobileNavVisualFindings(metrics, expectedWidth = 375) {
  const issues = [];
  if (!metrics || metrics.viewportWidth !== expectedWidth) {
    return ["Viewport contract mismatch (expected " + expectedWidth + "px)"];
  }
  for (const key of ["documentWidth", "bodyWidth"]) {
    if (!Number.isFinite(metrics[key]) || metrics[key] <= 0) {
      issues.push("Missing " + key + " geometry");
    } else if (metrics[key] > expectedWidth + 1) {
      issues.push("horizontal overflow: " + key + "=" + metrics[key] +
        "px > viewport " + expectedWidth + "px");
    }
  }
  if (!Number.isFinite(metrics.mainWidth) || metrics.mainWidth <= 0 ||
      !Number.isFinite(metrics.mainLeft) || !Number.isFinite(metrics.mainRight)) {
    issues.push("Missing visible workspace main geometry");
  } else if (metrics.mainLeft < -1 || metrics.mainRight > expectedWidth + 1) {
    issues.push("Workspace main exceeds the viewport: left=" +
      metrics.mainLeft + " right=" + metrics.mainRight);
  }
  if (!metrics.navVisible || !Number.isFinite(metrics.navWidth) ||
      !Number.isFinite(metrics.navHeight) ||
      metrics.navWidth <= 0 || metrics.navHeight <= 0) {
    issues.push("Mobile navigation opener is hidden or has no hit box");
  }
  if (metrics.navExpanded !== "false") {
    issues.push("Mobile navigation should be collapsed after navigating");
  }
  return issues;
}

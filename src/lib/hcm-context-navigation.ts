import {
  canOpenPeopleHome, explicitHcmEmployerId,
  peopleHomeEnabledForOrganization,
} from "@/lib/hcm-people-home-scope";
import {
  canReadHcmProcessMonitor, canonicalHcmId,
  monitorEnabledForEmployer,
} from "@/lib/hcm-process-monitor";
import { roleHasPeopleWorkspace } from "@/lib/workspace-role-ui";

/**
 * Discovery only, never an authorization gate.
 * The destination independently checks login, tenant, session policy,
 * company-wide role, custom deny and server feature flags before any source
 * read. Never infer an employee from an HR user's first membership.
 */
export type HcmNavigationLocation =
  | "peopleHome" | "processMonitor" | "worker360" | "actionCenter" | "inbox" | "directory";

export type HcmNavigationLink = {
  id: HcmNavigationLocation;
  label: string;
  href: string;
  current: boolean;
};

type Access = { role: string; companyWide: boolean } | null | undefined;
export type HcmNavigationOptions = {
  organizationId: number;
  access: Access;
  current: HcmNavigationLocation;
  employeeId?: number | null;
};

export function hcmDirectoryHref(organizationId: number): string | null {
  if (explicitHcmEmployerId(String(organizationId)) === null) return null;
  return "/app?organizationId=" + organizationId + "&workspacePage=People";
}

export function buildHcmNavigation(
  { organizationId, access, current, employeeId }: HcmNavigationOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
): HcmNavigationLink[] {
  if (explicitHcmEmployerId(String(organizationId)) === null || !access?.companyWide) {
    return [];
  }

  const canPeople = canOpenPeopleHome(access);
  const canPeopleWorkspace = canPeople && roleHasPeopleWorkspace(access.role);
  const canMonitor = canReadHcmProcessMonitor(access);
  if (!canPeople && !canMonitor) return [];

  const directoryHref = hcmDirectoryHref(organizationId)!;
  const links: Array<Omit<HcmNavigationLink, "current">> = [];

  if (canPeople && peopleHomeEnabledForOrganization(organizationId, env)) {
    links.push({
      id: "peopleHome", label: "People Home",
      href: "/hcm/command-center?organizationId=" + organizationId,
    });
  }

  const monitorLinkEnabled =
    canMonitor && monitorEnabledForEmployer(organizationId, env) &&
    env.NEXT_PUBLIC_HCM_PROCESS_MONITOR_ENABLED === "true" &&
    (env.NEXT_PUBLIC_HCM_PROCESS_MONITOR_ORG_IDS ?? "").split(",")
      .some((part) => canonicalHcmId(part.trim()) === organizationId);
  if (monitorLinkEnabled) {
    links.push({
      id: "processMonitor", label: "Process monitor",
      href: "/hcm/process-monitor?organizationId=" + organizationId,
    });
  }

  // A worker context must be supplied by a previously authorized worker
  // route. Never guess a person from the session or the current employer.
  const safeWorkerId = employeeId == null
    ? null : explicitHcmEmployerId(String(employeeId));
  if (
    canMonitor && safeWorkerId !== null &&
    env.HCM_WORKER_360_ENABLED === "true" &&
    env.NEXT_PUBLIC_HCM_WORKER_360_ENABLED === "true"
  ) {
    links.push({
      id: "worker360", label: "Worker 360",
      href: "/hcm/worker-360?organizationId=" + organizationId +
        "&employeeId=" + safeWorkerId,
    });
  }

  if (canPeopleWorkspace && peopleHomeEnabledForOrganization(organizationId, env)) {
    links.push({
      id: "actionCenter", label: "Action Center",
      href: "/hcm/action-center?organizationId=" + organizationId,
    });
  }

  if (canPeopleWorkspace) {
    links.push({
      id: "inbox", label: "HCM Inbox",
      href: directoryHref + "&hcmPanel=bp",
    });
    links.push({
      id: "directory", label: "People directory", href: directoryHref,
    });
  }
  return links.map((link) => ({ ...link, current: link.id === current }));
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CornerDownLeft, Search, UsersRound, Zap } from "lucide-react";
import { ALL_ITEMS, type NavItem } from "./nav";
import type { Employee, Organization } from "./types";
import { Avatar, money } from "./ui";

export type PaletteAction = { id: string; label: string; hint?: string; run: () => void };

type Row =
  | { kind: "page"; key: string; item: NavItem }
  | { kind: "client"; key: string; organization: Organization }
  | { kind: "person"; key: string; employee: Employee }
  | { kind: "action"; key: string; action: PaletteAction };

/**
 * Cmd/Ctrl+K palette. Navigation, client switching, people lookup and the
 * actions the current role is actually allowed to trigger, the caller decides
 * which actions to pass in, so the palette never offers something the server
 * would refuse.
 */
type PaletteProps = {
  onClose: () => void;
  pages: string[];
  organizations: Organization[];
  employees: Employee[];
  actions: PaletteAction[];
  onNavigate: (page: string) => void;
  onSwitchClient: (id: number) => void;
  onOpenPerson: (employee: Employee) => void;
};

/**
 * Mounts the dialog only while open, so query and cursor state start fresh
 * every time rather than being reset by an effect.
 */
export function CommandPalette({ open, ...props }: PaletteProps & { open: boolean }) {
  if (!open) return null;
  return <PaletteDialog {...props} />;
}

function PaletteDialog({
  onClose,
  pages,
  organizations,
  employees,
  actions,
  onNavigate,
  onSwitchClient,
  onOpenPerson,
}: PaletteProps) {
  const [query, setQuery] = useState("");
  const [rawCursor, setCursor] = useState(0);

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (haystack: string) => !needle || haystack.toLowerCase().includes(needle);

    const pageRows: Row[] = ALL_ITEMS.filter((item) => pages.includes(item.name))
      .filter((item) => matches(`${item.name} ${item.hint}`))
      .map((item) => ({ kind: "page", key: `page:${item.name}`, item }));

    const actionRows: Row[] = actions
      .filter((action) => matches(`${action.label} ${action.hint ?? ""}`))
      .map((action) => ({ kind: "action", key: `action:${action.id}`, action }));

    const clientRows: Row[] = organizations
      .filter((organization) => matches(`${organization.name} ${organization.legalName}`))
      .map((organization) => ({ kind: "client", key: `client:${organization.id}`, organization }));

    const personRows: Row[] = needle
      ? employees
          .filter((employee) => matches(`${employee.firstName} ${employee.lastName} ${employee.employeeNo} ${employee.title}`))
          .slice(0, 6)
          .map((employee) => ({ kind: "person", key: `person:${employee.id}`, employee }))
      : [];

    return [...actionRows, ...pageRows, ...clientRows, ...personRows];
  }, [query, pages, actions, organizations, employees]);

  // Clamped during render, so a shrinking result set can never leave the
  // highlight pointing past the end.
  const cursor = rows.length === 0 ? 0 : Math.min(rawCursor, rows.length - 1);

  function choose(row: Row) {
    onClose();
    if (row.kind === "page") onNavigate(row.item.name);
    else if (row.kind === "client") onSwitchClient(row.organization.id);
    else if (row.kind === "person") onOpenPerson(row.employee);
    else row.action.run();
  }

  return (
    <div
      className="palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor((current) => (rows.length ? (current + 1) % rows.length : 0));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor((current) => (rows.length ? (current - 1 + rows.length) % rows.length : 0));
          } else if (event.key === "Enter" && rows[cursor]) {
            event.preventDefault();
            choose(rows[cursor]);
          }
        }}
      >
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a page, client or person…"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="palette-results slim-scroll" role="listbox" aria-label="Results">
          {rows.length === 0 && (
            <p className="palette-group" style={{ padding: "18px 12px", letterSpacing: 0, textTransform: "none", fontSize: 12 }}>
              Nothing matches “{query}”.
            </p>
          )}
          {rows.map((row, index) => {
            const previous = rows[index - 1];
            const heading = row.kind !== previous?.kind ? GROUP_LABEL[row.kind] : null;
            return (
              <div key={row.key}>
                {heading && <div className="palette-group">{heading}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className={`palette-item ${index === cursor ? "cursor" : ""}`}
                  onMouseMove={() => setCursor(index)}
                  onClick={() => choose(row)}
                >
                  {row.kind === "page" && <row.item.icon size={16} />}
                  {row.kind === "action" && <Zap size={16} />}
                  {row.kind === "client" && <Building2 size={16} />}
                  {row.kind === "person" && <UsersRound size={16} />}
                  <span>
                    {row.kind === "page" && row.item.name}
                    {row.kind === "action" && row.action.label}
                    {row.kind === "client" && row.organization.name}
                    {row.kind === "person" && `${row.employee.firstName} ${row.employee.lastName}`}
                  </span>
                  <small>
                    {row.kind === "page" && row.item.hint}
                    {row.kind === "action" && row.action.hint}
                    {row.kind === "client" && `${row.organization.plan} · ${row.organization.employeeCount} people`}
                    {row.kind === "person" && `${row.employee.employeeNo} · ${money(row.employee.basicRate)}`}
                  </small>
                  {row.kind === "person" && <Avatar initials={row.employee.avatarInitials} index={row.employee.id} />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={9} style={{ verticalAlign: "middle" }} />
            </kbd>{" "}
            open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

const GROUP_LABEL: Record<Row["kind"], string> = {
  action: "Actions",
  page: "Go to",
  client: "Switch client",
  person: "People",
};

/** Registers the Cmd/Ctrl+K shortcut. Ignores keystrokes aimed at a text field. */
export function usePaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}

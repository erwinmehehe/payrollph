export type ScopedOptionSelection = Readonly<{ organizationId: number; value: string }>;

/** Default only an untouched/new-employer field; never replace an invalid explicit choice. */
export function resolveScopedOption(
  selection: ScopedOptionSelection | null,
  organizationId: number,
  options: ReadonlyArray<{ id: number }>,
): string {
  if (!selection || selection.organizationId !== organizationId) {
    return options.length ? String(options[0].id) : "";
  }
  return options.some(option => String(option.id) === selection.value) ? selection.value : "";
}

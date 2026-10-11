export type ScopedOptionSelection = Readonly<{ organizationId: number; value: string }>;

/** Default only an untouched/new-employer field; never replace an invalid explicit choice. */
export function resolveScopedOption(
  selection: ScopedOptionSelection | null,
  organizationId: number,
  options: ReadonlyArray<{ id: number }>,
  defaultIndex = 0,
): string {
  if (!selection || selection.organizationId !== organizationId) {
    const option = options[defaultIndex] ?? options[0];
    return option ? String(option.id) : "";
  }
  return options.some(option => String(option.id) === selection.value) ? selection.value : "";
}

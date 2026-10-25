/**
 * Source -> isolated clean-baseline table/column coverage ratchet.
 * Does not certify constraint/type parity, historical migration receipts,
 * production schema, or an applied migration.
 */
function checkedName(name, label) {
  if (typeof name !== "string" || !/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error("SOURCE_BASELINE_INVALID_" + label);
  }
  return name;
}

export function assertSourceBaselineParity(sourceTables, catalogRows) {
  if (!Array.isArray(sourceTables) || !Array.isArray(catalogRows) || sourceTables.length === 0) {
    throw new Error("SOURCE_BASELINE_INVALID_INPUT");
  }
  const expected = new Map();
  for (const table of sourceTables) {
    const name = checkedName(table?.name, "TABLE");
    if (expected.has(name) || !Array.isArray(table?.columns) || !table.columns.length) {
      throw new Error("SOURCE_BASELINE_DUPLICATE_OR_EMPTY_TABLE");
    }
    const columns = new Set();
    for (const column of table.columns) {
      const col = checkedName(column?.name, "COLUMN");
      if (columns.has(col)) throw new Error("SOURCE_BASELINE_DUPLICATE_SOURCE_COLUMN");
      columns.add(col);
    }
    expected.set(name, columns);
  }

  const actual = new Map();
  for (const row of catalogRows) {
    const table = checkedName(row?.table_name, "CATALOG_TABLE");
    const column = checkedName(row?.column_name, "CATALOG_COLUMN");
    if (!actual.has(table)) actual.set(table, new Set());
    if (actual.get(table).has(column)) throw new Error("SOURCE_BASELINE_DUPLICATE_CATALOG_COLUMN");
    actual.get(table).add(column);
  }

  const missingTables = [...expected.keys()].filter((name) => !actual.has(name)).sort();
  const missingColumns = [];
  const unmodeledColumns = [];
  let checkedColumns = 0;
  for (const [table, columns] of expected) {
    checkedColumns += columns.size;
    const present = actual.get(table) ?? new Set();
    for (const column of columns) if (!present.has(column)) missingColumns.push(table + "." + column);
    for (const column of present) if (!columns.has(column)) unmodeledColumns.push(table + "." + column);
  }
  missingColumns.sort();
  unmodeledColumns.sort();
  if (missingTables.length || missingColumns.length) {
    throw new Error("SOURCE_BASELINE_MISSING " + JSON.stringify({ missingTables, missingColumns }));
  }
  return {
    sourceTables: expected.size,
    sourceColumns: checkedColumns,
    migrationOrBaselineOnlyTables: [...actual.keys()].filter((name) => !expected.has(name)).sort(),
    unmodeledColumns,
    productionCertified: false,
  };
}

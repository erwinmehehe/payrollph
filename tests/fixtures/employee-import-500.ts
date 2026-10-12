export function importFixtureCsv(withErrors = true) {
  const rows = Array.from({ length: 500 }, (_, i) => [
    `EMP-${String(i + 1).padStart(4, "0")}`, "Synthetic", `Worker ${i+1}`, "Staff", "Regular", "Active", "15-Oct-2026", "30000", "no", "NCR", "123456789", "OPS", "1234567890", "BDO",
  ]);
  if (withErrors) {
    for (let i = 10; i < 15; i++) rows[i][10] = "12-BAD";
    for (let i = 20; i < 25; i++) rows[i][0] = rows[0][0];
    for (let i = 30; i < 35; i++) rows[i][6] = "2026-02-30";
    for (let i = 40; i < 45; i++) rows[i][11] = "FOREIGN-DEPARTMENT";
  }
  return ["Employee No,First Name,Last Name,Title,Employment Type,Status,Start Date,Monthly Basic,MWE,Region,TIN,Department,Bank Account,Bank Code", ...rows.map(r => r.join(","))].join("\n");
}

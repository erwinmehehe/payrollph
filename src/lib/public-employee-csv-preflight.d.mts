export declare const PUBLIC_CSV_MAX_BYTES: number;
export declare const PUBLIC_CSV_MAX_ROWS: number;
export declare const PUBLIC_CSV_REQUIRED: readonly string[];
export type CsvPreflightIssue = { row: number; severity: "error" | "warning"; field: string; message: string };
export type CsvPreflightResult = { totalRows: number; issues: CsvPreflightIssue[]; missingColumns: string[]; unrecognizedColumns: number };
export declare function checkEmployeeCsvLocally(input: string): CsvPreflightResult;
export declare function employeeCsvDiagnosticReport(result: CsvPreflightResult): string;
export declare const FICTIONAL_EMPLOYEE_CSV: string;

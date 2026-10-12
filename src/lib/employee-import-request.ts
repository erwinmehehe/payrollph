import { db } from "@/db";
import { commitEmployeeImport, ImportBatchRejected, readEmployeeImportContext } from "./employee-import-batch-server";
import { employeeImportErrorCsv, importPreviewReceipt, previewEmployeeImport, validImportPreviewReceipt, type EmployeeImportPreview } from "./employee-import-preview";
import { GOVERNED_HIRE_REQUIRED } from "./hcm-direct-entry-policy";

export async function handleEmployeeImportPreview(input: {
  body: Record<string, unknown>; organizationId: number; csv: string; fileName: string;
  user: { id: number; name: string; sessionToken: string }; seatLimit: number | null;
}, database = db) {
  const skips = input.body.skipLines ?? [];
  if (!Array.isArray(skips) || skips.some(n => !Number.isInteger(n)) || skips.length > 10000) return Response.json({ error: "skipLines must contain CSV row numbers." }, { status: 400 });
  const skipLines = skips as number[];
  const context = await readEmployeeImportContext(input.organizationId, database);
  const preview = previewEmployeeImport(input.csv, { ...context, skipLines });
  const receipt = importPreviewReceipt(input.csv, input.organizationId, skipLines, input.user.sessionToken);
  const publicResult = (result: EmployeeImportPreview) => ({
    rows: result.rows, totalRows: result.totalRows, errorCount: result.errorCount,
    warningCount: result.warningCount, blockingErrorCount: result.blockingErrorCount,
    skippedCount: result.skippedCount, fileErrors: result.fileErrors,
    newEligibleCount: result.candidates.length, errorCsv: employeeImportErrorCsv(result),
  });
  if (input.body.action === "preview" || input.body.dryRun === true) return Response.json({ ...publicResult(preview), previewToken: receipt, dryRun: true });
  if (input.body.action !== "commit" || !validImportPreviewReceipt(input.body.previewToken, receipt)) return Response.json({ error: "Preview this exact CSV and skip selection before committing.", ...publicResult(preview) }, { status: 409 });
  try {
    const committed = await commitEmployeeImport({ organizationId: input.organizationId, csv: input.csv, skipLines, fileName: input.fileName, actor: input.user.name, actorId: input.user.id, seatLimit: input.seatLimit }, database);
    return Response.json({ ...publicResult(committed.preview), batchId: committed.batchId, createdCount: committed.createdCount, dryRun: false });
  } catch (error) {
    if (error instanceof ImportBatchRejected) return Response.json({ error: error.message, ...publicResult({ ...error.preview, fileErrors: [...error.preview.fileErrors, error.message] }), createdCount: 0 }, { status: 422 });
    if (error instanceof Error && error.message === "HCM_GOVERNED_HIRE_REQUIRED") return Response.json(GOVERNED_HIRE_REQUIRED, { status: 409 });
    // A database failure rolls back the entire batch; retain a downloadable receipt.
    return Response.json({ error: "The batch could not commit. No employees were inserted; retry after resolving the database failure.", createdCount: 0, ...publicResult({ ...preview, fileErrors: [...preview.fileErrors, "Batch transaction failed and was rolled back."] }) }, { status: 500 });
  }
}

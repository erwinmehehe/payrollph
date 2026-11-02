export type EmployeeImportAction = "preview" | "commit";

/** Human-readable, privacy-safe feedback. Never render raw provider/SQL errors
 * or imply an uncertain commit did not write employee records. */
export function employeeImportFailureMessage(status: number, action: EmployeeImportAction): string {
  if (status === 401) return "Your session ended. Sign in again before uploading employee data.";
  if (status === 403) return "Your role cannot import employees for this employer. Ask an authorized People administrator.";
  if (status === 402) return "This organization's plan or employee seat limit does not allow this import.";
  if (status === 409) return action === "commit"
    ? "The roster or preview changed. No retry is authorized until you check the employee directory and create a fresh preview."
    : "The employer's import state changed. Refresh the preview before committing.";
  if (status === 400 || status === 422) return "The CSV did not pass validation. Review the file errors and highlighted rows, then refresh the preview.";
  if (status === 429) return "Too many requests. Wait for the server's retry window and try preview again.";
  return action === "commit"
    ? "The import outcome could not be confirmed. Check the employee directory before attempting another commit."
    : "The preview could not be completed. Your file remains selected; try preview again.";
}

export function employeeImportNetworkFailure(action: EmployeeImportAction): string {
  return action === "commit"
    ? "The connection failed during commit and the outcome is unknown. Check the employee directory before trying again."
    : "Could not reach the server to validate this CSV. Check your connection and retry the preview.";
}

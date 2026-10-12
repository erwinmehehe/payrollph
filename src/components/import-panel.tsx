"use client";
import { EmployeeImportPreviewPanel } from "./employee-import-preview-panel";

export function ImportPanel({organizationId,onImported,previewEnabled=false}:{
 organizationId:number;onImported:()=>void;previewEnabled?:boolean;
}) {
 if(!previewEnabled)return <section className="card" aria-label="Employee CSV import unavailable">
   <h2>Import employees</h2>
   <p>CSV import is temporarily disabled until row-by-row preview and atomic commit are enabled for this deployment.
   Individual employee creation remains available. No CSV rows will be imported without validation.</p>
 </section>;
 return <EmployeeImportPreviewPanel key={organizationId} organizationId={organizationId} onImported={onImported}/>;
}

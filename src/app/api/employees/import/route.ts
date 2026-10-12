import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { handleEmployeeImportPreview } from "@/lib/employee-import-request";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { importBatches } from "@/db/schema";
import { GOVERNED_HIRE_REQUIRED, hasConfiguredHireBusinessProcess } from "@/lib/hcm-direct-entry-policy";
import { getSessionUser } from "@/lib/auth";
import { getEntitlements, requireFeature } from "@/lib/billing";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { requireSaasPaidWrites } from "@/lib/saas-workspace-access";

export const dynamic = "force-dynamic";

/** New employee CSV intake is always upload -> preview -> commit.
 * No legacy partial imports and no database writes on preview requests. */
export async function POST(request: Request) {
 const originDenied=enforceSameOriginMutation(request);
 if(originDenied)return originDenied;
 const user=await getSessionUser();
 if(!user)return Response.json({error:"Authentication required."},{status:401});
 const body=await request.json().catch(()=>({}));
 const organizationId=Number(body.organizationId);
 const csv=typeof body.csv==="string"?body.csv:"";
 const fileName=String(body.fileName??"upload.csv").slice(0,200);
 if(!Number.isSafeInteger(organizationId)||organizationId<=0||!csv.trim())
   return Response.json({error:"A valid employer and CSV are required."},{status:400});
 if(Buffer.byteLength(csv,"utf8")>2*1024*1024)
   return Response.json({error:"CSV import exceeds the 2 MB limit."},{status:413});
 if(!criticalReleaseFlagEnabled("employeeImportPreview"))
   return Response.json({error:"Employee CSV import is paused until atomic preview acceptance is enabled.",
    code:"EMPLOYEE_IMPORT_PREVIEW_DISABLED"},{status:503});
 if(body.action!=="preview"&&body.action!=="commit"&&body.dryRun!==true)
   return Response.json({error:"Upload and preview this CSV before committing."},{status:400});
 const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,
   "Only People administrators can import employee records.");
 if(denied)return denied;
 const access=await getAccess(user.id,organizationId);
 if(!access?.companyWide)return Response.json({error:"Bulk imports require company-wide People administrator access."},{status:403});
 const mfaDenied=requireSensitiveActionMfa(user);
 if(mfaDenied)return mfaDenied;
 if(await hasConfiguredHireBusinessProcess(organizationId))
   return Response.json(GOVERNED_HIRE_REQUIRED,{status:409});
 if(body.action==="commit"){
   const paidDenied=await requireSaasPaidWrites(organizationId);
   if(paidDenied)return paidDenied;
 }
 const entitlements=await getEntitlements(organizationId);
 const gate=requireFeature(entitlements,"imports");
 if(gate)return gate;
 return handleEmployeeImportPreview({body,organizationId,csv,fileName,user,seatLimit:entitlements.seatLimit});
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedList = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view import history.",
  );
  if (deniedList) return deniedList;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Import history is available only to company-wide People administrators." }, { status: 403 });
  }
  await ensureMigrationSchema();
  const batches = await db.select().from(importBatches).where(eq(importBatches.organizationId, organizationId));
  return Response.json({ batches: batches.slice(-10).reverse() });
}

export const TEMPLATE_CSV = `Employee No,First Name,Last Name,Title,Employment Type,Status,Start Date,Monthly Basic,MWE,Region,Email,Mobile,Bank Account,Bank Code
EMP-001,Juan,Dela Cruz,Driver,Regular,Active,2026-01-15,21500.00,no,NCR,juan@example.com,09171234567,1234567890,BDO
EMP-002,Maria,Santos,Bookkeeper,Regular,Active,2026-03-01,28000.00,no,III,maria@example.com,09181234567,1234567891,BPI
EMP-003,Pedro,Reyes,Helper,Probationary,Active,2026-06-01,22500.00,no,NCR,,,,
`;

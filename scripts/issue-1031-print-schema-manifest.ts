import { generateSchemaManifest } from "./lib/issue-1031-schema-manifest";
const manifest=generateSchemaManifest();
if (manifest.tables.length < 270) throw new Error("Manifest incomplete");
process.stdout.write(JSON.stringify(manifest,null,2)+"\n");

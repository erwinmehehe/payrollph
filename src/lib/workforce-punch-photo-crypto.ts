import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { parseBankEncryptionKey } from "@/lib/bank-account-crypto";
const PURPOSE="linaw:wfm-punch-photo-evidence:v1";
const PREFIX="enc:wfmpunch:v1:";
function key(env:Readonly<Record<string,string|undefined>>,previous=false){
 const raw=env[previous?"PII_ENCRYPTION_KEY_PREVIOUS":"PII_ENCRYPTION_KEY"];
 if(!raw) return null;
 const root=parseBankEncryptionKey(raw);
 if(!root)throw new Error("PII_ENCRYPTION_KEY must contain 32 bytes.");
 return createHmac("sha256",root).update(PURPOSE).digest();
}
export function encryptPunchPhoto(bytes:Uint8Array, env:Readonly<Record<string,string|undefined>>=process.env){
 if(!bytes.length||bytes.length>512*1024)throw new Error("Punch photo must be 1-512 KB.");
 const k=key(env);
 if(!k)throw new Error("Dedicated encrypted photo evidence key missing.");
 const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",k,iv);
 const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
 return PREFIX+[iv,cipher.getAuthTag(),encrypted].map(p=>p.toString("base64url")).join(":");
}
export function decryptPunchPhoto(sealed:string,env:Readonly<Record<string,string|undefined>>=process.env){
 if(!sealed.startsWith(PREFIX))throw new Error("Unknown punch photo envelope.");
 const parts=sealed.slice(PREFIX.length).split(":").map(x=>Buffer.from(x,"base64url"));
 if(parts.length!==3||parts[0].length!==12||parts[1].length!==16||parts[2].length===0)
   throw new Error("Invalid encrypted punch photo.");
 for(const k of [key(env),key(env,true)]){
   if(!k)continue;
   try{
     const dec=createDecipheriv("aes-256-gcm",k,parts[0]);
     dec.setAuthTag(parts[1]);
     return Buffer.concat([dec.update(parts[2]),dec.final()]);
   }catch{ /* rotation key may not match */ }
 }
 throw new Error("Punch photo cannot be decrypted.");
}

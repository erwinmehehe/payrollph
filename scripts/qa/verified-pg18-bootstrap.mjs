#!/usr/bin/env node
/**
 * Only run a FIRST Drizzle push to a VERIFIED EMPTY disposable PG18 GitHub
 * CI database. Fail closed on Drizzle Kit 0.31.x SQL errors logged with exit 0.
 * NEVER use against an existing database, Neon or a production migration.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDisposablePG18Environment } from "./fresh-pg18-development-schema.mjs";

export function classifyInitialPush(exitCode, stdout, stderr) {
  const output=String(stdout??"")+"\n"+String(stderr??"");
  if(exitCode!==0)throw new Error("PG18_FIRST_PUSH_BAD_EXIT");
  if(/(^|\n)\s*(?:error|fatal|exception)\s*:|error\s*\[|error\s*\(|\b(?:unhandled|failed to execute)\b/i.test(output)){
    throw new Error("PG18_FIRST_PUSH_REPORTED_ERROR");
  }
  if(!/\bchanges applied\b/i.test(output) || /\bno changes detected\b/i.test(output)){
    throw new Error("PG18_FIRST_PUSH_NO_CONFIRMED_CREATION");
  }
  return true;
}

export async function runStrictInitialPush(env=process.env) {
  assertDisposablePG18Environment(env);
  // External workflow has already performed an empty-catalog PG18 preflight.
  const cmd=process.platform==="win32"?"npm.cmd":"npm";
  const child=spawn(cmd,["run","db:push"],{shell:false,env,stdio:["ignore","pipe","pipe"]});
  let stdout="",stderr="",launchFailed=false,oversized=false;
  const CAP=512_000;
  for(const [stream,label] of [[child.stdout,"out"],[child.stderr,"err"]]){
    stream.on("data",bytes=>{
      if(label==="out")stdout+=bytes.toString("utf8");
      else stderr+=bytes.toString("utf8");
      if(stdout.length+stderr.length>CAP){oversized=true;child.kill();}
    });
  }
  child.on("error",()=>{launchFailed=true;});
  const code=await new Promise(resolve=>child.once("close",resolve));
  if(launchFailed||oversized)throw new Error("PG18_FIRST_PUSH_RUNNER_FAILED");
  classifyInitialPush(code,stdout,stderr);
  process.stdout.write("FRESH_PG18_FIRST_PUSH_VERIFIED (catalog validation follows)\n");
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runStrictInitialPush().catch(error=>{
    const code=error instanceof Error&&/^PG18_FIRST_PUSH_[A-Z_]+$/.test(error.message)
      ?error.message:"PG18_FIRST_PUSH_UNEXPECTED_FAILURE";
    process.stderr.write(code+"\n");
    process.exitCode=1;
  });
}

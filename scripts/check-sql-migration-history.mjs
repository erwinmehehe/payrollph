#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SQL = /^drizzle\/[^/]+\.sql$/;
const NUMBERED = /^drizzle\/([0-9]{4})_[a-z0-9][a-z0-9_-]*\.sql$/;

export function analyzeMigrationChanges(baseFiles, changes) {
  const byPrefix = new Map();
  for (const path of baseFiles.filter(p => SQL.test(p))) {
    const match = path.match(NUMBERED);
    if (!match) continue;
    byPrefix.set(match[1], [...(byPrefix.get(match[1]) ?? []), path]);
  }
  const maxNumber = Math.max(0, ...[...byPrefix.keys()].map(Number));
  const legacyDuplicatePrefixes = [...byPrefix].filter(([, files]) => files.length > 1).map(([n]) => n);
  const newPrefixes = new Set();
  const errors = [];
  for (const { status, path } of changes.filter(item => SQL.test(item.path))) {
    if (status !== "A") {
      errors.push("Do not edit or remove an existing SQL migration: " + status + " " + path);
      continue;
    }
    const match = path.match(NUMBERED);
    if (!match) {
      errors.push("New migration needs a numbered drizzle/NNNN_name.sql basename: " + path);
      continue;
    }
    if (Number(match[1]) <= maxNumber || newPrefixes.has(match[1]) || byPrefix.has(match[1])) {
      errors.push("New migration number conflicts with existing history: " + path);
    }
    newPrefixes.add(match[1]);
  }
  return { maxNumber, legacyDuplicatePrefixes, errors,
    changedSql: changes.filter(item => SQL.test(item.path)).length };
}

export function parseDiff(raw) {
  const entries = raw.split("\0").filter(Boolean);
  if (entries.length % 2) throw new Error("Unexpected git diff encoding");
  const changes = [];
  for (let i = 0; i < entries.length; i += 2) {
    const status = entries[i];
    if (!["A","M","D","T"].includes(status)) throw new Error("Unexpected git diff change type");
    changes.push({status,path:entries[i+1]});
  }
  return changes;
}
function git(...args) {
  return execFileSync("git", args, {encoding:"utf8",maxBuffer:5*1024*1024});
}
export function main() {
  const base = process.env.PR_BASE_REF ?? "";
  const head = process.env.PR_HEAD_SHA ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base) || base.includes("..")
    || base.endsWith("/") || !/^[a-f0-9]{40}$/.test(head)) {
    throw new Error("Validated base branch and exact PR head SHA required");
  }
  const currentBase=git("rev-parse","--verify","refs/remotes/origin/"+base).trim();
  const mergeBase=git("merge-base",currentBase,head).trim();
  if (!/^[a-f0-9]{40}$/.test(mergeBase)) throw new Error("Unverifiable current merge base");
  const historic=git("ls-tree","-r","--name-only",mergeBase,"--","drizzle").split("\n").filter(Boolean);
  const changes=parseDiff(git("diff","--name-status","--no-renames","-z",mergeBase,head,"--","drizzle"));
  const result=analyzeMigrationChanges(historic,changes);
  const summary=[
    "## SQL Migration History Guard (advisory)","",
    "Changed SQL files: "+result.changedSql,
    "Last existing migration number: "+String(result.maxNumber).padStart(4,"0"),
    "Legacy duplicate number groups (unchanged): "+result.legacyDuplicatePrefixes.length,
    "Outcome: "+(result.errors.length ? "FAIL" : "PASS"),"",
    ...result.errors.map(e=>"- "+e),"",
    "This check never executes DDL or certifies the production migration history.",
    "An actual DBA-applied checksum journal, staging rehearsal and release authorization are separate.",""
  ].join("\n");
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
  if(result.errors.length)process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{main()}catch(error){console.error("Migration guard unavailable: "+(error instanceof Error?error.message:"unknown"));process.exitCode=1}
}

/**
 * #1031 source-vs-catalog full schema comparison. Pure evaluation: no SQL and
 * no data access. Every result is structural evidence ONLY.
 */
export const EVIDENCE = "CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL" as const;
export type Column = {name:string;type:string;nullable:boolean;default:string|null;identity:string|null};
export type ForeignKey = {name:string;columns:string[];refTable:string;refColumns:string[];onDelete:string;onUpdate:string};
export type Index = {name:string;unique:boolean;method:string;keys:string[];predicate:string|null;
  include?:string[];options?:string[];nullsNotDistinct?:boolean;tablespace?:string|null};
export type Check = {name:string;expression:string};
export type Key = {name:string;columns:string[]};
export type Unique = Key & {nullsNotDistinct:boolean};
export type SchemaTable = {name:string;columns:Column[];foreignKeys:ForeignKey[];indexes:Index[];checks:Check[];primaryKeys:Key[];uniqueConstraints:Unique[]};
export type SchemaManifest = {formatVersion:1;evidenceScope:typeof EVIDENCE;source:string;tables:SchemaTable[]};
export type CatalogRow = {table_name:string;kind:string;object_name:string;type?:string|null;nullable?:boolean|null;default?:string|null;identity?:string|null;columns?:string[]|null;ref_table?:string|null;ref_columns?:string[]|null;on_delete?:string|null;on_update?:string|null;unique?:boolean|null;method?:string|null;keys?:string[]|null;predicate?:string|null;expression?:string|null;nulls_not_distinct?:boolean|null;valid?:boolean|null;ready?:boolean|null;validated?:boolean|null};
export type DiffRow = {table:string;object:string;kind:string;status:"PASS"|"MISSING"|"DRIFT"|"EXTRA";expected:unknown;actual:unknown;evidenceScope:typeof EVIDENCE};
/**
 * Normalize syntax outside quoted literals only. Case-sensitive literal text
 * is preserved. Only *proven, type-checked* PostgreSQL deparser rewrites for
 * simple varchar/numeric constants and varchar IN lists are canonicalized;
 * all unrecognized casts, operators or literal differences remain DRIFT.
 */
function normSql(v: string | null | undefined): string | null {
  if (v == null) return null;
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]!;
    if (ch === "'") {
      out += ch;
      let closed = false;
      for (i += 1; i < v.length; i++) {
        const token = v[i]!;
        out += token;
        if (token === "'") {
          if (v[i + 1] === "'") { out += "'"; i += 1; continue; }
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error("Unterminated SQL string literal");
      continue;
    }
    if (ch === '"') {
      let identifier = "";
      let closed = false;
      for (i += 1; i < v.length; i++) {
        const token = v[i]!;
        if (token === '"') {
          if (v[i + 1] === '"') { identifier += '"'; i += 1; continue; }
          closed = true;
          break;
        }
        identifier += token;
      }
      if (!closed) throw new Error("Unterminated SQL identifier");
      out += /^[a-z_][a-z0-9_]*$/.test(identifier)
        ? identifier : '"' + identifier.replaceAll('"', '""') + '"';
      continue;
    }
    if (/\s/.test(ch)) {
      if (!out.endsWith(" ")) out += " ";
      continue;
    }
    out += ch.toLowerCase();
  }
  return out.trim();
}
function normColumnDefault(x: { default?: string | null; type?: string | null; table_name?: string; name?: string; object_name?: string }): string | null {
  const table = x.table_name;
  const column = x.name ?? x.object_name;
  if (x.default === "__serial__") {
    if (!table || !column) throw new Error("Serial source column lacks its owning table/name");
    return "serial:" + table + "_" + column + "_seq";
  }
  const expression = normSql(x.default);
  const serial = expression?.match(/^nextval\('(?:public\.)?([a-z_][a-z0-9_]*)'::regclass\)$/);
  if (serial) return "serial:" + serial[1];

  // PostgreSQL stores an untyped literal default as an implicit cast to the
  // column's real SQL type. Treat only the identical quoted value and its
  // exact type-matched cast as the same; never erase arbitrary ::text casts.
  const type = normType(x.type ?? "");
  if (expression != null) {
    const literal = /^'(?:[^']|'')*'$/;
    if (/^character varying(?:\(\d+\))?$/.test(type)) {
      const trimmed = expression.endsWith("::character varying")
        ? expression.slice(0, -"::character varying".length) : expression;
      if (literal.test(trimmed)) return trimmed + "::character varying";
    }
    if (/^numeric(?:\(\d+,\d+\))?$/.test(type)) {
      const trimmed = expression.endsWith("::numeric")
        ? expression.slice(0, -"::numeric".length) : expression;
      if (/^'[-+]?(?:\d+(?:\.\d*)?|\.\d+)'$/.test(trimmed))
        return trimmed + "::numeric";
    }
  }
  return expression;
}
function normIdentity(value: string | null | undefined): string | null {
  if (value === "a") return "always";
  if (value === "d") return "byDefault";
  return value || null;
}
function normType(v:string){let s=v.toLowerCase().trim();s=s.replace(/\bvarchar\b/g,"character varying").replace(/\btimestamptz\b/g,"timestamp with time zone").replace(/\btimestamp\b(?! with| without)/g,"timestamp without time zone").replace(/\bint4\b/g,"integer").replace(/\bint8\b/g,"bigint").replace(/\bbool\b/g,"boolean").replace(/\bnumeric\((\d+),\s*(\d+)\)/g,"numeric($1,$2)");if(s==="serial")return "integer";if(s==="bigserial")return "bigint";return s;}

/**
 * PostgreSQL deparses VARCHAR CHECK (... IN ('a','b')) to the equivalent
 * ((column)::text = ANY ((ARRAY['a'::character varying,...])::text[])).
 * Canonicalize only these two tightly constrained grammars, keeping exact
 * literal values/order, column identity and constraint validation status.
 * Never normalize unknown predicates, operators, casts, or malformed lists.
 */
function normCheckExpression(input: string, columnTypes: ReadonlyMap<string, string>, table: string): string {
  const value = normSql(input) ?? "";
  const source = /^(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*) in \(([^()]*)\)$/.exec(value);
  const catalog = /^\(\(([a-z_][a-z0-9_]*)\)::text = any \(\(array\[([^\]]*)\]\)::text\[\]\)\)$/.exec(value);
  if (!source && !catalog) return value;
  if (source?.[1] && source[1] !== table) return value;
  const column = source ? source[2]! : catalog![1]!;
  // Each side must independently prove the column is VARCHAR. Integer and
  // fixed-width character IN comparisons can differ from text-cast ANY.
  if (!/^character varying(?:\(\d+\))?$/.test(normType(columnTypes.get(column) ?? ""))) return value;
  const values = (source ? source[3]! : catalog![2]!).split(",").map(s => s.trim());
  if (values.length < 2) return value;
  const quotedLiteral = /^'(?:[^']|'')*'$/;
  const checked = values.map(v => catalog && v.endsWith("::character varying")
    ? v.slice(0, -"::character varying".length) : v);
  if (checked.some((v,i) => !quotedLiteral.test(v) ||
      (catalog && !values[i]!.endsWith("::character varying")))) return value;
  return "varchar-in:" + column + ":" + JSON.stringify(checked);
}
function normIndexKey(s: string) { return normSql(s) ?? ""; }
function normAction(s:string){return s.toLowerCase().replace(/_/g," ").trim();}
function signature(kind:string,x:any,columnTypes:ReadonlyMap<string,string>,table:string){if(kind==="table")return {name:x.name??x.object_name};if(kind==="column")return {type:normType(x.type),nullable:!!x.nullable,default:normColumnDefault(x),identity:normIdentity(x.identity)};if(kind==="foreign_key")return {columns:x.columns??[],refTable:x.refTable??x.ref_table,refColumns:x.refColumns??x.ref_columns??[],onDelete:normAction(x.onDelete??x.on_delete??"no action"),onUpdate:normAction(x.onUpdate??x.on_update??"no action"),validated:x.validated===undefined?true:!!x.validated};if(kind==="index")return {unique:!!x.unique,method:(x.method??"btree").toLowerCase(),keys:(x.keys??[]).map(normIndexKey),predicate:normSql(x.predicate),valid:x.valid===undefined?true:!!x.valid,ready:x.ready===undefined?true:!!x.ready};if(kind==="check")return {expression:normCheckExpression(x.expression,columnTypes,table),validated:x.validated===undefined?true:!!x.validated};if(kind==="primary_key")return {columns:x.columns??[],validated:x.validated===undefined?true:!!x.validated};if(kind==="unique_constraint")return {columns:x.columns??[],nullsNotDistinct:!!(x.nullsNotDistinct??x.nulls_not_distinct),validated:x.validated===undefined?true:!!x.validated};return x;}
function expectedObjects(manifest:SchemaManifest){const map=new Map<string,{table:string;kind:string;object:string;expected:unknown}>();const put=(table:string,kind:string,object:string,expected:unknown)=>{const key=[table,kind,object].join("\0");if(map.has(key))throw new Error("duplicate expected object "+key);map.set(key,{table,kind,object,expected})};for(const t of manifest.tables){put(t.name,"table",t.name,{name:t.name});for(const c of t.columns)put(t.name,"column",c.name,{...c,table_name:t.name});for(const x of t.foreignKeys)put(t.name,"foreign_key",x.name,x);for(const x of t.indexes)put(t.name,"index",x.name,x);for(const x of t.checks)put(t.name,"check",x.name,x);for(const x of t.primaryKeys)put(t.name,"primary_key",x.name,x);for(const x of t.uniqueConstraints)put(t.name,"unique_constraint",x.name,x)}return map;}
export function diffSchema(manifest:SchemaManifest,catalog:CatalogRow[]):DiffRow[]{const expectedTypes = new Map(manifest.tables.map(t => [t.name, new Map(t.columns.map(c => [c.name, c.type]))]));
const observedTypes = new Map<string, Map<string, string>>();
for (const r of catalog) {
  if (r.kind !== "column") continue;
  const types = observedTypes.get(r.table_name) ?? new Map<string, string>();
  types.set(r.object_name, r.type ?? "");
  observedTypes.set(r.table_name, types);
}
const exp=expectedObjects(manifest);const obs=new Map<string,CatalogRow>();for(const r of catalog){if(!["table","column","foreign_key","index","check","primary_key","unique_constraint"].includes(r.kind))throw new Error("unsupported catalog kind");const key=[r.table_name,r.kind,r.object_name].join("\0");if(obs.has(key))throw new Error("duplicate observed catalog object: "+key);obs.set(key,r)}const result:DiffRow[]=[];for(const [key,e] of exp){const a=obs.get(key);const expected=signature(e.kind,e.expected,expectedTypes.get(e.table) ?? new Map(),e.table);const actual=a?signature(e.kind,a,observedTypes.get(e.table) ?? new Map(),e.table):null;const status=!a?"MISSING":JSON.stringify(expected)===JSON.stringify(actual)?"PASS":"DRIFT";result.push({table:e.table,object:e.object,kind:e.kind,status,expected,actual,evidenceScope:EVIDENCE});obs.delete(key)}for(const r of obs.values()){result.push({table:r.table_name,object:r.object_name,kind:r.kind,status:"EXTRA",expected:null,actual:signature(r.kind,r,observedTypes.get(r.table_name) ?? new Map(),r.table_name),evidenceScope:EVIDENCE})}return result.sort((a,b)=>a.table.localeCompare(b.table)||a.kind.localeCompare(b.kind)||a.object.localeCompare(b.object));}

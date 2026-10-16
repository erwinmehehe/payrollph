/**
 * Source-only PostgreSQL SQL statement parser for #1031/P0-4.
 * Tokenizes comments, quoted identifiers, SQL strings, nested block comments
 * and dollar bodies before separating statements; never connects to a DB.
 * Procedural/dynamic SQL is flagged for human review, not certified as parsed.
 */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  const word = c => /[A-Za-z_0-9$]/.test(c);
  while (i < text.length) {
    const a = i, c = text[i], n = text[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && n === "-") {
      i += 2; while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2; let depth = 1;
      while (i < text.length && depth > 0) {
        if (text.slice(i, i + 2) === "/*") { depth++; i += 2; }
        else if (text.slice(i, i + 2) === "*/") { depth--; i += 2; }
        else i++;
      }
      if (depth) throw Error("Unclosed SQL block comment");
      continue;
    }
    if (c === "'") {
      i++; let value = "", closed = false;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") { value += "'"; i += 2; continue; }
          i++; closed = true; break;
        }
        value += text[i++];
      }
      if (!closed) throw Error("Unclosed SQL string");
      tokens.push({ kind: "string", value, offset: a }); continue;
    }
    if (c === '"') {
      i++; let value = "", closed = false;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { value += '"'; i += 2; continue; }
          i++; closed = true; break;
        }
        value += text[i++];
      }
      if (!closed) throw Error("Unclosed SQL identifier");
      tokens.push({ kind: "ident", value, offset: a }); continue;
    }
    if (c === "$") {
      const match = /^\$[A-Za-z_0-9]*\$/.exec(text.slice(i));
      if (match) {
        const delimiter = match[0], from = i + delimiter.length;
        const until = text.indexOf(delimiter, from);
        if (until < 0) {
          tokens.push({ kind: "dollar_unclosed", value: text.slice(from), offset: a });
          i = text.length; continue;
        }
        tokens.push({ kind: "dollar", value: text.slice(from, until), offset: a });
        i = until + delimiter.length; continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      i++; while (i < text.length && word(text[i])) i++;
      tokens.push({ kind: "word", value: text.slice(a, i).toUpperCase(), offset: a });
      continue;
    }
    if (/[0-9]/.test(c)) {
      i++; while (i < text.length && /[0-9.]/.test(text[i])) i++;
      tokens.push({ kind: "number", value: text.slice(a, i), offset: a });
      continue;
    }
    tokens.push({ kind: "symbol", value: c, offset: a }); i++;
  }
  return tokens;
}
const kw = (tokens, i, value) => tokens[i]?.kind === "word" && tokens[i].value === value;
function nameAt(tokens, i) {
  const first = tokens[i];
  if (!first || !["word","ident"].includes(first.kind)) return null;
  let name = first.kind === "word" ? first.value.toLowerCase() : first.value;
  let next = i + 1;
  while (tokens[next]?.value === "." && ["word","ident"].includes(tokens[next + 1]?.kind)) {
    const t = tokens[next + 1];
    name = t.kind === "word" ? t.value.toLowerCase() : t.value;
    next += 2;
  }
  return { name, next };
}
function afterOptional(tokens, i) {
  if (kw(tokens, i, "IF")) {
    i++; if (kw(tokens, i, "NOT")) i++;
    if (kw(tokens, i, "EXISTS")) i++;
  }
  if (kw(tokens, i, "ONLY")) i++;
  return i;
}
function namesAfterReferences(tokens) {
  const names = new Set();
  for (let i=0;i<tokens.length;i++) if (kw(tokens,i,"REFERENCES")) {
    const target = nameAt(tokens, i+1);
    if (target) names.add(target.name);
  }
  return [...names];
}
function innerActions(tokens) {
  const actions = new Set();
  for (let i=0;i<tokens.length;i++) {
    if (kw(tokens,i,"DROP") && ["TABLE","INDEX","CONSTRAINT","COLUMN","TYPE","FUNCTION","TRIGGER","SCHEMA"].some(k=>kw(tokens,i+1,k))) actions.add("DROP");
    if (kw(tokens,i,"DELETE") && kw(tokens,i+1,"FROM")) actions.add("DELETE");
    if (kw(tokens,i,"UPDATE") && nameAt(tokens,i+1) && tokens.slice(i+2,i+8).some(t=>t.value==="SET")) actions.add("UPDATE");
    if (kw(tokens,i,"INSERT") && kw(tokens,i+1,"INTO")) actions.add("INSERT");
    if (kw(tokens,i,"TRUNCATE")) actions.add("TRUNCATE");
  }
  return [...actions];
}
export function parseMigrationSql(text) {
  const tokens = tokenize(text), statements = [];
  let current = [];
  for (const token of tokens) {
    if (token.value === ";" && token.kind === "symbol") {
      if (current.length) statements.push(current);
      current = [];
    } else current.push(token);
  }
  if (current.length) statements.push(current);
  const typeSet = new Set(), touched = new Set(), creates = new Set(), requires = new Set(), hazards = new Set(), review = new Set();
  let unclassified = 0;
  const add = (name, target) => { if (name) { touched.add(name); if (target) creates.add(name); } };
  for (const stmt of statements) {
    const words = stmt.filter(t=>t.kind==="word");
    if (!words.length) continue;
    let i=0, type="";
    if (kw(stmt,0,"CREATE")) {
      i=1;
      if (kw(stmt,i,"OR") && kw(stmt,i+1,"REPLACE")) i+=2;
      while (["UNIQUE","CONCURRENTLY","TEMP","TEMPORARY","UNLOGGED"].some(k=>kw(stmt,i,k))) i++;
      if (kw(stmt,i,"TABLE")) {
        type="CREATE TABLE"; const obj=nameAt(stmt,afterOptional(stmt,i+1));
        add(obj?.name,true);
      } else if (kw(stmt,i,"INDEX")) {
        type="CREATE INDEX";
        const obj=nameAt(stmt,afterOptional(stmt,i+1));
        for(let j=i+1;j<stmt.length;j++) if(kw(stmt,j,"ON")) {
          const target=nameAt(stmt,afterOptional(stmt,j+1));
          add(target?.name,false); if(target)requires.add(target.name); break;
        }
        if (!obj) review.add("INDEX_NAME_UNPARSED");
      } else { type="CREATE OTHER"; review.add("NON_TABLE_SQL_OBJECT"); }
    } else if(kw(stmt,0,"ALTER")) {
      type="ALTER";
      const j=kw(stmt,1,"TABLE")?2:kw(stmt,1,"INDEX")?2:-1;
      if(j>=0){const obj=nameAt(stmt,afterOptional(stmt,j)); add(obj?.name,false); if(obj)requires.add(obj.name);}
      else review.add("NON_TABLE_ALTER");
    } else if(kw(stmt,0,"DROP")) {
      type="DROP"; hazards.add("DROP");
      if(kw(stmt,1,"TABLE")) {const obj=nameAt(stmt,afterOptional(stmt,2)); add(obj?.name,false);}
      else review.add("NON_TABLE_DROP");
    } else if(kw(stmt,0,"UPDATE")) {
      type="DML/backfill"; hazards.add("UPDATE"); hazards.add("BACKFILL");
      const obj=nameAt(stmt,1); add(obj?.name,false);if(obj)requires.add(obj.name);
    } else if(kw(stmt,0,"DELETE") && kw(stmt,1,"FROM")) {
      type="DML/backfill";hazards.add("DELETE");hazards.add("BACKFILL");
      const obj=nameAt(stmt,2);add(obj?.name,false);if(obj)requires.add(obj.name);
    } else if(kw(stmt,0,"INSERT") && kw(stmt,1,"INTO")) {
      type="DML/backfill"; hazards.add("INSERT"); hazards.add("BACKFILL");
      const obj=nameAt(stmt,2);add(obj?.name,false);if(obj)requires.add(obj.name);
    } else if(kw(stmt,0,"TRUNCATE")) {
      type="DML/backfill";hazards.add("TRUNCATE");review.add("DESTRUCTIVE_TRUNCATE");
      const obj=nameAt(stmt,afterOptional(stmt,kw(stmt,1,"TABLE")?2:1));add(obj?.name,false);
    } else if(kw(stmt,0,"DO") || (kw(stmt,0,"CREATE") && words.some(t=>t.value==="FUNCTION"))) {
      type="PROCEDURAL";review.add("PROCEDURAL_SQL_REVIEW");
    } else if(kw(stmt,0,"COMMENT") || kw(stmt,0,"GRANT") || kw(stmt,0,"REVOKE") || kw(stmt,0,"SELECT") || kw(stmt,0,"SET")) {
      type="OTHER";
    } else {
      type="UNCLASSIFIED";unclassified++; review.add("UNCLASSIFIED_STATEMENT");
    }
    // DDL inside a DO/function body may be conditional or dynamic. Report a
    // conservative hazard; do not promote it to verified table definitions.
    for(const fragment of stmt.filter(t=>t.kind==="dollar" || t.kind==="dollar_unclosed")) {
      if (fragment.kind === "dollar_unclosed") { review.add("UNTERMINATED_DOLLAR_BODY"); hazards.add("PARSER_UNCERTAINTY"); }
      review.add("DOLLAR_BODY_MANUAL_REVIEW");
      const inner=tokenize(fragment.value);
      for(const action of innerActions(inner)){hazards.add(action);if(["UPDATE","DELETE","INSERT"].includes(action))hazards.add("BACKFILL");}
      if(inner.some((t,k)=>kw(inner,k,"EXECUTE")))review.add("DYNAMIC_SQL_REVIEW");
    }
    for(const action of innerActions(stmt)) {
      if(action==="DROP") hazards.add("DROP");
    }
    for(const dependency of namesAfterReferences(stmt))requires.add(dependency);
    typeSet.add(type);
  }
  // Creating a table and referencing it within this file is not an external
  // file prerequisite, but retain it in touched objects for a DBA to inspect.
  return {
    statementTypes:[...typeSet].sort(),
    objects:[...touched].sort(),
    creates:[...creates].sort(),
    requires:[...requires].filter(t=>!creates.has(t)).sort(),
    hazards:[...hazards].sort(),
    review:[...review].sort(),
    statementCount:statements.length,unclassified
  };
}

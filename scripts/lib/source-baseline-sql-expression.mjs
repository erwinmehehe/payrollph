/**
 * Bounded, fail-closed SQL expression parity for PostgreSQL deparser forms.
 * Table and column identifiers are compared with exact spelling. Only a
 * qualifier matching the owning table may be removed from a known column.
 * AST precedence preserves grouping, operators and case-sensitive literals;
 * unrelated casts and unknown syntax are never declared equivalent.
 * No source/catalog result here certifies any production migration or Neon.
 */
function tokens(input) {
  if (typeof input !== "string") throw new Error("SOURCE_BASELINE_INVALID_EXPRESSION");
  const result = [];
  for (let i = 0; i < input.length;) {
    if (/\s/.test(input[i])) { i++; continue; }
    if (input[i] === "'") {
      let value = "", closed = false; i++;
      for (; i < input.length; i++) {
        if (input[i] === "'") {
          if (input[i + 1] === "'") { value += "'"; i++; continue; }
          closed = true; i++; break;
        }
        value += input[i];
      }
      if (!closed) throw new Error("EXPR_UNTERMINATED_LITERAL");
      result.push({ kind: "string", value }); continue;
    }
    if (input[i] === '"') {
      let value = "", closed = false; i++;
      for (; i < input.length; i++) {
        if (input[i] === '"') {
          if (input[i + 1] === '"') { value += '"'; i++; continue; }
          closed = true; i++; break;
        }
        value += input[i];
      }
      if (!closed) throw new Error("EXPR_UNTERMINATED_IDENTIFIER");
      result.push({ kind: "identifier", value, quoted: true }); continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(input.slice(i));
    if (number) { result.push({ kind: "number", value: number[0] }); i += number[0].length; continue; }
    const name = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(input.slice(i));
    if (name) { result.push({ kind: "identifier", value: name[0], quoted: false }); i += name[0].length; continue; }
    const op = /^(?:!~\*|!~~|!~|~\*|~~|::|>=|<=|<>|!=|\|\||&&|[(),.\[\]=<>~*\/%+\-])/.exec(input.slice(i));
    if (op) { result.push({ kind: "operator", value: op[0] }); i += op[0].length; continue; }
    throw new Error("EXPR_UNKNOWN_TOKEN");
  }
  return result;
}
function parseExpressionSql(input, table, columnTypes) {
  const items = tokens(input); let pos = 0;
  const peek = (offset = 0) => items[pos + offset];
  const kw = (value, offset = 0) => peek(offset)?.kind === "identifier" &&
    !peek(offset)?.quoted && peek(offset).value.toLowerCase() === value;
  const at = (value) => peek()?.value === value;
  const eat = (value) => { if (kw(value) || at(value)) { pos++; return true; } return false; };
  const need = (value) => { if (!eat(value)) throw new Error("EXPR_EXPECTED_" + value); };
  const precedence = (op) => {
    if (op === "or") return 1;
    if (op === "and") return 2;
    if (["=", "<>", "!=", "<", ">", "<=", ">=", "~", "~*", "!~", "!~*",
      "like", "~~", "not like", "!~~"].includes(op)) return 3;
    if (["+", "-", "||"].includes(op)) return 4;
    if (["*", "/", "%"].includes(op)) return 5;
    return -1;
  };
  function readType() {
    let name = "";
    const allowed = new Set(["text", "numeric", "integer", "character", "varying", "timestamp",
      "with", "without", "time", "zone", "bigint", "smallint", "boolean"]);
    while (peek()?.kind === "identifier" && !peek().quoted &&
      allowed.has(peek().value.toLowerCase())) {
      name += (name ? " " : "") + items[pos++].value.toLowerCase();
    }
    if (!name) throw new Error("EXPR_UNSUPPORTED_CAST_TYPE");
    if (eat("[")) { need("]"); name += "[]"; }
    return name;
  }
  function atom() {
    const token = items[pos++];
    if (!token) throw new Error("EXPR_UNEXPECTED_END");
    if (token.value === "(") { const result = parse(0); need(")"); return result; }
    if (token.kind === "string") return { kind: "string", value: token.value };
    if (token.kind === "number") return { kind: "number", value: token.value };
    if (token.value === "-" || token.value === "+") {
      const operand = parse(6);
      return operand.kind === "number"
        ? { kind: "number", value: (token.value === "-" ? "-" : "") + operand.value }
        : { kind: "unary", op: token.value, arg: operand };
    }
    if (token.kind !== "identifier") throw new Error("EXPR_UNEXPECTED_ATOM");
    const name = token.value;
    if (!token.quoted && name.toLowerCase() === "not")
      return { kind: "unary", op: "not", arg: parse(3) };
    if (!token.quoted && ["null", "true", "false"].includes(name.toLowerCase()))
      return { kind: name.toLowerCase() };
    if (!token.quoted && name.toLowerCase() === "array" && eat("[")) {
      const values = [];
      if (!eat("]")) { do { values.push(parse(0)); } while (eat(",")); need("]"); }
      return { kind: "array", values };
    }
    if (!token.quoted && ["any", "all"].includes(name.toLowerCase()) && eat("(")) {
      const arg = parse(0); need(")");
      return { kind: "quantifier", mode: name.toLowerCase(), arg };
    }
    const parts = [name];
    while (eat(".")) {
      const item = items[pos++];
      if (item?.kind !== "identifier") throw new Error("EXPR_INVALID_IDENTIFIER");
      parts.push(item.value);
    }
    if (eat("(")) {
      const args = [];
      if (!eat(")")) {
        if (parts.length === 1 && parts[0].toLowerCase() === "trim" && eat("both")) {
          need("from"); args.push(parse(0));
        } else {
          do { args.push(parse(0)); } while (eat(","));
        }
        need(")");
      }
      return { kind: "call", name: parts.join("."), args };
    }
    if (parts.length === 1 && columnTypes.has(parts[0]))
      return { kind: "column", name: parts[0] };
    if (parts.length === 2 && parts[0] === table && columnTypes.has(parts[1]))
      return { kind: "column", name: parts[1] };
    return { kind: "identifier", parts };
  }
  function parse(min) {
    let lhs = atom();
    for (;;) {
      if (at("::")) {
        if (7 < min) break;
        pos++; lhs = { kind: "cast", type: readType(), arg: lhs }; continue;
      }
      if (kw("is") && 3 >= min) {
        pos++; const negate = eat("not"); need("null");
        lhs = { kind: "isnull", arg: lhs, negate }; continue;
      }
      if ((kw("in") || (kw("not") && kw("in", 1))) && 3 >= min) {
        const negate = eat("not"); need("in"); need("(");
        const values = [];
        if (!eat(")")) { do { values.push(parse(0)); } while (eat(",")); need(")"); }
        lhs = { kind: "in", negate, left: lhs, values }; continue;
      }
      if (kw("between") && 3 >= min) {
        pos++; const low = parse(4); need("and"); const high = parse(4);
        lhs = { kind: "logical", op: "and", args: [
          { kind: "binary", op: ">=", left: lhs, right: low },
          { kind: "binary", op: "<=", left: lhs, right: high },
        ] }; continue;
      }
      const token = peek();
      const op = token?.kind === "identifier" && !token.quoted
        ? token.value.toLowerCase() : token?.value;
      const bp = precedence(op);
      if (bp < min || bp < 0) break;
      pos++; const rhs = parse(bp + 1);
      lhs = op === "and" || op === "or"
        ? { kind: "logical", op, args: [lhs, rhs] }
        : { kind: "binary", op, left: lhs, right: rhs };
    }
    return lhs;
  }
  const ast = parse(0);
  if (pos !== items.length) throw new Error("EXPR_UNPARSED_TAIL");
  return ast;
}
function normalizeAst(node, columnTypes) {
  const n = { ...node };
  const columnType = (col) => columnTypes.get(col.name) ?? "";
  const textColumn = (x) => x.kind === "column" &&
    /^(?:text|varchar|character varying)(?:\(\d+\))?$/.test(columnType(x));
  const numericColumn = (x) => x.kind === "column" &&
    /^(?:numeric(?:\(|$)|double precision$|real$)/.test(columnType(x));
  const numericLiteral = (x) => {
    if (x.kind !== "cast" || x.type !== "numeric") return x;
    if (x.arg.kind === "number") return x.arg;
    const inner = x.arg;
    if (inner.kind === "cast" && inner.type === "integer" &&
      inner.arg.kind === "string" && /^-?\d+$/.test(inner.arg.value)) {
      return { kind: "number", value: inner.arg.value };
    }
    return x;
  };
  switch (n.kind) {
    case "string": case "number": case "null": case "true": case "false":
    case "column": case "identifier": return n;
    case "unary":
      n.arg = normalizeAst(n.arg, columnTypes);
      if (n.op === "-" && n.arg.kind === "number")
        return { kind: "number", value: "-" + n.arg.value };
      return n;
    case "cast":
      n.arg = normalizeAst(n.arg, columnTypes);
      if (n.type === "text" && (n.arg.kind === "string" || textColumn(n.arg)))
        return n.arg;
      return n;
    case "call":
      n.args = n.args.map((x) => normalizeAst(x, columnTypes)); return n;
    case "isnull":
      n.arg = normalizeAst(n.arg, columnTypes); return n;
    case "array":
      n.values = n.values.map((x) => normalizeAst(x, columnTypes)); return n;
    case "quantifier":
      n.arg = normalizeAst(n.arg, columnTypes); return n;
    case "in":
      n.left = normalizeAst(n.left, columnTypes);
      n.values = n.values.map((x) => normalizeAst(x, columnTypes));
      if (n.values.length === 1)
        return normalizeAst({ kind: "binary", op: n.negate ? "<>" : "=",
          left: n.left, right: n.values[0] }, columnTypes);
      return n;
    case "logical":
      n.args = n.args.map((x) => normalizeAst(x, columnTypes))
        .flatMap((x) => x.kind === "logical" && x.op === n.op ? x.args : [x]);
      return n;
    case "binary":
      n.left = normalizeAst(n.left, columnTypes);
      n.right = normalizeAst(n.right, columnTypes);
      if (n.op === "!=") n.op = "<>";
      if (n.op === "~~") n.op = "like";
      if (n.op === "!~~") n.op = "not like";
      if (numericColumn(n.left)) n.right = numericLiteral(n.right);
      if (numericColumn(n.right)) n.left = numericLiteral(n.left);
      if (["=", "<>"].includes(n.op) && n.right.kind === "quantifier" &&
        n.left.kind === "column") {
        const quant = n.right;
        const arr = quant.arg.kind === "cast" && quant.arg.type === "text[]"
          ? quant.arg.arg : quant.arg;
        if (arr.kind === "array" && quant.mode === (n.op === "=" ? "any" : "all")) {
          const type = columnType(n.left);
          let values = null;
          if (/^(?:varchar|character varying|text)(?:\(\d+\))?$/.test(type) &&
            arr.values.every((x) => x.kind === "cast" &&
              ["character varying", "text"].includes(x.type) && x.arg.kind === "string")) {
            values = arr.values.map((x) => x.arg);
          } else if (/^(?:integer|smallint|bigint|numeric(?:\(|$))/.test(type) &&
            arr.values.every((x) => x.kind === "number")) {
            values = arr.values;
          }
          if (values) return { kind: "in", negate: n.op !== "=", left: n.left, values };
        }
      }
      return n;
    default: throw new Error("EXPR_UNKNOWN_AST_NODE");
  }
}
export function canonicalSourceBaselineExpression(expression, table, columnTypes) {
  if (typeof expression !== "string" || !(columnTypes instanceof Map))
    throw new Error("SOURCE_BASELINE_INVALID_EXPRESSION_INPUT");
  try {
    return JSON.stringify(normalizeAst(parseExpressionSql(expression, table, columnTypes), columnTypes));
  } catch {
    // Fail closed: if either dialect has unsupported SQL, it compares its
    // original text rather than guessing that two different forms are equal.
    return "raw:" + expression;
  }
}

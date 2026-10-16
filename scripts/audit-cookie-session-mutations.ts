import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export type CookieOriginFinding = { path: string; handler: string; line: number; problem: string };

function routes(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const next = join(path, entry.name);
    return entry.isDirectory() ? routes(next) : entry.name === "route.ts" ? [next] : [];
  });
}

export function cookieOriginFindings(path: string, source: string): CookieOriginFinding[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: CookieOriginFinding[] = [];
  const bodyContains = (node: ts.Node, name: string) => node.getText(file).includes(name);
  const handlers: Array<{ name: string; body: ts.Node; declaration: ts.Node }> = [];

  for (const statement of file.statements) {
    const exported = ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;

    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body &&
      MUTATIONS.has(statement.name.text)) {
      handlers.push({ name: statement.name.text, body: statement.body, declaration: statement });
    } else if (ts.isVariableStatement(statement)) {
      // Next.js accepts both named functions and exported arrow-function
      // route handlers. Previously the latter were invisible to this AST audit.
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !MUTATIONS.has(declaration.name.text)) continue;
        let initializer = declaration.initializer;
        while (initializer && ts.isParenthesizedExpression(initializer)) initializer = initializer.expression;
        if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          handlers.push({ name: declaration.name.text, body: initializer.body, declaration });
        }
      }
    }
  }

  for (const { name: method, body, declaration } of handlers) {
    const handler = body.getText(file);
    const origin = handler.indexOf("enforceSameOriginMutation(");
    const session = handler.indexOf("getSessionUser(");
    const line = file.getLineAndCharacterOfPosition(declaration.getStart(file)).line + 1;

    // Non-cookie webhook, bearer and token exchanges are separate review lanes.
    if (session < 0) continue;
    if (origin < 0) {
      findings.push({ path, handler: method, line, problem: "Session mutation has no same-origin guard" });
    } else if (origin > session) {
      findings.push({ path, handler: method, line, problem: "Session may be read before same-origin guard" });
    } else if (!bodyContains(body, "if (originDenied)") && !bodyContains(body, "if (originCheck)")) {
      // Avoid claiming guard completeness for a call whose denial is discarded.
      // Different route variable names are supported below.
      const tail = handler.slice(origin);
      if (!/if\s*\(\s*[a-zA-Z_$][\w$]*\s*\)\s*return\s+[a-zA-Z_$][\w$]*\s*;?/.test(tail)) {
        findings.push({ path, handler: method, line, problem: "Same-origin guard return path is not visible" });
      }
    }
  }
  return findings;
}

export function auditCookieSessionMutationRoutes(root = "src/app/api"): {
  inspectedRoutes: number;
  findings: CookieOriginFinding[];
} {
  const paths = routes(root);
  return {
    inspectedRoutes: paths.length,
    findings: paths.flatMap((path) => cookieOriginFindings(path, readFileSync(path, "utf8"))),
  };
}

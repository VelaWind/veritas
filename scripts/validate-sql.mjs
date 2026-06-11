// Validates SQL files against the real PostgreSQL grammar (pg_query WASM).
// Splits on top-level semicolons (respecting $$ dollar-quoting, 'string'
// literals and comments) and parses each statement. A FRESH WASM module is
// created per statement: pg-query-emscripten corrupts its heap when one
// instance parses many/large statements, producing spurious cascade failures.
import { readFileSync } from "node:fs";
import PgQueryModule from "pg-query-emscripten";

const files = process.argv.slice(2);

function splitStatements(sql) {
  const stmts = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  let dollarTag = null;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === "*" && next === "/") {
        buf += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (!inSingle && !dollarTag && ch === "-" && next === "-") {
      inLineComment = true;
      buf += ch;
      i++;
      continue;
    }
    if (!inSingle && !dollarTag && ch === "/" && next === "*") {
      inBlockComment = true;
      buf += ch;
      i++;
      continue;
    }
    if (!dollarTag && ch === "'") {
      inSingle = !inSingle;
      buf += ch;
      i++;
      continue;
    }
    if (!inSingle && ch === "$") {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        if (dollarTag === null) dollarTag = tag;
        else if (dollarTag === tag) dollarTag = null;
        buf += tag;
        i += tag.length;
        continue;
      }
    }
    if (!inSingle && !dollarTag && ch === ";") {
      buf += ch;
      stmts.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) stmts.push(buf);
  return stmts;
}

async function parseOne(stmt) {
  // Fresh instance avoids cross-statement heap corruption.
  const pg = await new PgQueryModule();
  return pg.parse(stmt);
}

let totalErrors = 0;
for (const file of files) {
  const sql = readFileSync(file, "utf8");
  const stmts = splitStatements(sql);
  let fileErrors = 0;
  let parsed = 0;
  let idx = 0;
  for (const stmt of stmts) {
    idx++;
    const trimmed = stmt.trim();
    if (!trimmed || trimmed === ";") continue;
    let result;
    try {
      result = await parseOne(trimmed);
    } catch (e) {
      fileErrors++;
      totalErrors++;
      console.error(
        `\n✗ ${file} [stmt #${idx}] threw: ${e?.message ?? e}\n  near: ${trimmed.slice(0, 90).replace(/\s+/g, " ")}…`,
      );
      continue;
    }
    if (result.error) {
      fileErrors++;
      totalErrors++;
      const snippet = trimmed.slice(0, 100).replace(/\s+/g, " ");
      console.error(
        `\n✗ ${file} [stmt #${idx}]\n  ${result.error.message} (cursor ${result.error.cursorpos})\n  near: ${snippet}…`,
      );
    } else {
      parsed++;
    }
  }
  if (fileErrors === 0) {
    console.log(`✓ ${file} — ${parsed} statements parsed clean`);
  } else {
    console.log(`✗ ${file} — ${fileErrors} statement(s) failed to parse`);
  }
}

process.exit(totalErrors > 0 ? 1 : 0);

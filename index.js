#!/usr/bin/env node
// Read-only SQL MCP server (stdio) for PostgreSQL or Oracle. Pick with DB_TYPE=postgres|oracle (default postgres).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import oracledb from "oracledb";
import { z } from "zod";

const DB_TYPE = (process.env.DB_TYPE ?? "postgres").toLowerCase();
const MAX_ROWS = Number(process.env.MAX_ROWS ?? 1000);
const TIMEOUT_MS = Number(process.env.STATEMENT_TIMEOUT_MS ?? 30000);

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`${missing.join(", ")} is not set`);
    process.exit(1);
  }
}

// Each driver exposes run(sql, binds) -> rows, always inside a read-only transaction that is rolled back.
function postgresDriver() {
  requireEnv("DATABASE_URL");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return {
    async run(sql, values = []) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN TRANSACTION READ ONLY");
        await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
        // queryMode 'extended' makes Postgres reject multi-statement input, so "COMMIT; DROP ..." cannot escape the transaction.
        return (await client.query({ text: sql, values, queryMode: "extended" })).rows ?? [];
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    },
    listTablesSql: `SELECT table_schema, table_name, table_type FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1, 2`,
    describe: (table, schema) => [
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [schema ?? "public", table],
    ],
  };
}

function oracleDriver() {
  requireEnv("ORACLE_USER", "ORACLE_PASSWORD", "ORACLE_CONNECT_STRING");
  const poolP = oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMax: 5,
  });
  return {
    async run(sql, binds = []) {
      const text = sql.trim().replace(/;\s*$/, ""); // Oracle rejects a trailing ';'
      // DDL auto-commits in Oracle and escapes SET TRANSACTION READ ONLY, so only plain queries are allowed.
      // shortcut: keyword filter cannot see writes hidden in existing PL/SQL functions; use a SELECT-only DB user.
      if (!/^[\s(]*(SELECT|WITH)\b/i.test(text) || /\bWITH\s+(FUNCTION|PROCEDURE)\b/i.test(text)) {
        throw new Error("Only SELECT/WITH queries are allowed (read-only).");
      }
      const conn = await (await poolP).getConnection();
      try {
        conn.callTimeout = TIMEOUT_MS;
        await conn.execute("SET TRANSACTION READ ONLY");
        // Oracle runs one statement per execute(), so "SELECT ...; DROP ..." fails to parse.
        const res = await conn.execute(text, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: MAX_ROWS + 1 });
        return res.rows ?? [];
      } finally {
        await conn.rollback().catch(() => {});
        await conn.close();
      }
    },
    listTablesSql: `SELECT owner AS table_schema, table_name, 'TABLE' AS table_type FROM all_tables
      WHERE owner NOT IN (SELECT username FROM all_users WHERE oracle_maintained = 'Y')
      UNION ALL
      SELECT owner, view_name, 'VIEW' FROM all_views
      WHERE owner NOT IN (SELECT username FROM all_users WHERE oracle_maintained = 'Y')
      ORDER BY 1, 2`,
    // Unquoted Oracle names are stored uppercase, so match both as given and uppercased.
    describe: (table, schema) => [
      `SELECT owner, column_name, data_type, data_length, data_precision, data_scale, nullable, data_default
       FROM all_tab_columns
       WHERE table_name IN (:t, UPPER(:t))
         AND (:s IS NULL OR owner IN (:s, UPPER(:s)))
         AND owner NOT IN (SELECT username FROM all_users WHERE oracle_maintained = 'Y')
       ORDER BY owner, column_id`,
      { t: table, s: schema ?? null },
    ],
  };
}

const drivers = { postgres: postgresDriver, oracle: oracleDriver };
if (!drivers[DB_TYPE]) {
  console.error(`Unsupported DB_TYPE "${DB_TYPE}" (use postgres or oracle)`);
  process.exit(1);
}
const db = drivers[DB_TYPE]();

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] });
const tool = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (e) {
    return fail(e);
  }
};

const server = new McpServer({ name: `${DB_TYPE}-readonly`, version: "1.1.0" });

server.registerTool(
  "query",
  {
    description: `Run a single read-only SQL statement on ${DB_TYPE} (SELECT/WITH). Writes are rejected. Returns at most ${MAX_ROWS} rows.`,
    inputSchema: { sql: z.string().describe(`One ${DB_TYPE} SQL statement`) },
  },
  tool(async ({ sql }) => {
    const rows = await db.run(sql);
    return { rowCount: Math.min(rows.length, MAX_ROWS), truncated: rows.length > MAX_ROWS, rows: rows.slice(0, MAX_ROWS) };
  })
);

server.registerTool(
  "list_tables",
  { description: `List tables and views in user schemas of the ${DB_TYPE} database.`, inputSchema: {} },
  tool(() => db.run(db.listTablesSql))
);

server.registerTool(
  "describe_table",
  {
    description: "Show columns (name, type, nullable, default) of a table.",
    inputSchema: {
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema/owner. Postgres default: public. Oracle default: any user schema"),
    },
  },
  tool(({ table, schema }) => db.run(...db.describe(table, schema)))
);

await server.connect(new StdioServerTransport());

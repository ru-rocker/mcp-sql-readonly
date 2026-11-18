// Smoke test: npm test, against the DB seeded from seed.sql (Postgres) or seed-oracle.sql (DB_TYPE=oracle).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert";

const oracle = process.env.DB_TYPE === "oracle";
const T = oracle ? "app.customers" : "customers";

const c = new Client({ name: "test", version: "1" });
await c.connect(new StdioClientTransport({ command: "node", args: ["index.js"], env: { ...process.env } }));
const call = async (name, args = {}) => c.callTool({ name, arguments: args });
const text = (r) => r.content[0].text;
const count = async () => text(await call("query", { sql: `SELECT count(*) AS n FROM ${T}` }));

assert.deepEqual((await c.listTools()).tools.map((t) => t.name).sort(), ["describe_table", "list_tables", "query"]);
assert.match(text(await call("list_tables")), /customers/i);
assert.match(text(await call("describe_table", { table: "customers" })), /"column_name": "email"/i);
assert.match(await count(), /"n": "?5"?/i);

// Every write attempt must fail and leave the data untouched.
for (const sql of [`DELETE FROM ${T}`, `COMMIT; DELETE FROM ${T}`, `SELECT 1 AS x FROM ${T}; DELETE FROM ${T}`, `DROP TABLE ${T}`, "CREATE TABLE mcp_tmp (id int)"]) {
  const r = await call("query", { sql });
  assert.ok(r.isError, `must be rejected: ${sql}\n${text(r)}`);
}
assert.match(await count(), /"n": "?5"?/i);

console.log(`all tests passed (${oracle ? "oracle" : "postgres"})`);
await c.close();

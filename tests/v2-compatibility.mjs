// Optional: verify the adapter against the full SQL files you already have.
// node tests/v2-compatibility.mjs /path/to/00_fresh_install_v2.sql /path/to/01_seed_demo_data.sql
// Everything runs inside embedded PostgreSQL. No live Supabase connection.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PostgresRepository } from "../server/repositories/postgres.js";
import { StatusService } from "../server/status-service.js";
import { personId, dinnerId } from "../server/demo-data.js";
const [schemaFile, seedFile] = process.argv.slice(2);
if (!schemaFile || !seedFile)
  throw new Error(
    "Supply the full v2 fresh-install SQL path and seed SQL path.",
  );
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  await db.exec(await readFile(schemaFile, "utf8"));
  await db.exec(await readFile(seedFile, "utf8"));
  await db.exec(
    await readFile(
      new URL("../database/host_status_reader.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec("SET ROLE dinner_dashboard_reader");
  const queries = [];
  const query = async (sql, args) => {
    queries.push(sql);
    return db.query(sql, args);
  };
  const repo = new PostgresRepository({
    pool: { query, connect: async () => ({ query, release() {} }) },
  });
  const service = new StatusService(repo);
  const maya = await service.get(personId(1), dinnerId(1));
  assert.equal(maya.summary.student_signups, 3);
  assert.equal(maya.summary.family_seats, 2);
  assert.equal(maya.summary.seats_reserved, 5);
  assert.equal(maya.roster.length, 3);
  const ben = await service.get(personId(14), dinnerId(2));
  assert.equal(ben.display.status, "full");
  const zoe = await service.get(personId(11), dinnerId(401));
  assert.equal(zoe.display.status, "ended");
  const sam = await service.get(personId(16), dinnerId(104));
  assert.equal(sam.display.status, "completed");
  await assert.rejects(
    () => service.get(personId(14), dinnerId(1)),
    (error) => error.status === 404,
  );
  assert.ok(
    !queries.some((sql) =>
      /host_roster\(|my_hosted_dinners\(|GROUP BY|COUNT\(/i.test(sql),
    ),
  );
  console.log(
    "Full v2 schema + provided seed: compatible. Counts, dietary roster, four host scenarios and ownership verified without SQL business-function calls.",
  );
} finally {
  await db.close();
}

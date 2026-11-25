import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PostgresRepository } from "../server/repositories/postgres.js";
import { StatusService } from "../server/status-service.js";
import {
  makeDemoData,
  personId,
  dinnerId,
  DEMO_HOST_IDS,
} from "../server/demo-data.js";
async function fixture(t) {
  const db = new PGlite();
  const queries = [];
  await db.exec(`CREATE SCHEMA dinner_app;
    CREATE TABLE dinner_app.profiles(id uuid PRIMARY KEY,full_name text,phone_number text);
    CREATE TABLE dinner_app.dinners(id uuid PRIMARY KEY,host_id uuid REFERENCES dinner_app.profiles(id),title text,
      topic_category text,description text,address text,starts_at timestamptz,ends_at timestamptz,
      signup_deadline timestamptz,guest_capacity integer,status text);
    CREATE TABLE dinner_app.registrations(id uuid PRIMARY KEY,dinner_id uuid REFERENCES dinner_app.dinners(id),
      student_id uuid REFERENCES dinner_app.profiles(id),status text,family_seats integer,dietary_notes text,
      family_dietary_notes text,created_at timestamptz);
    ALTER TABLE dinner_app.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE dinner_app.dinners ENABLE ROW LEVEL SECURITY;
    ALTER TABLE dinner_app.registrations ENABLE ROW LEVEL SECURITY;`);
  const data = makeDemoData();
  for (const table of ["profiles", "dinners", "registrations"])
    for (const row of data[table]) {
      const keys = Object.keys(row);
      await db.query(
        `INSERT INTO dinner_app.${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        Object.values(row),
      );
    }
  await db.exec(
    await readFile(
      new URL("../database/host_status_reader.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec("SET ROLE dinner_dashboard_reader");
  const client = {
    query: async (sql, args) => {
      queries.push(sql);
      return db.query(sql, args);
    },
    release() {},
  };
  const repo = new PostgresRepository({
    pool: {
      connect: async () => client,
      query: client.query,
      end: () => db.close(),
    },
  });
  t.after(() => repo.close());
  return { db, repo, queries };
}
test("real PostgreSQL queries support v2 rows, dedicated reader grants and JS status calculation", async (t) => {
  const { repo, queries } = await fixture(t);
  const service = new StatusService(repo);
  const result = await service.get(personId(1), dinnerId(1));
  assert.equal(result.summary.student_signups, 3);
  assert.equal(result.summary.seats_reserved, 5);
  assert.equal(result.summary.family_seats, 2);
  assert.match(
    result.roster.find((r) => r.family_seats).family_dietary_notes,
    /pescatarian/,
  );
  assert.equal(result.display.status, "confirmed");
  assert.match(queries[0], /REPEATABLE READ READ ONLY/);
  assert.equal(queries.at(-1), "COMMIT");
  assert.ok(
    !queries.some((sql) =>
      /host_roster\(|my_hosted_dinners\(|GROUP BY|COUNT\(/i.test(sql),
    ),
  );
  const hosts = await repo.hosts(DEMO_HOST_IDS);
  assert.equal(hosts.length, 4);
});
test("PostgreSQL ownership filters reject cross-host requests before returning rosters", async (t) => {
  const { repo } = await fixture(t);
  const service = new StatusService(repo);
  await assert.rejects(
    () => service.get(personId(14), dinnerId(1)),
    (e) => e.status === 404,
  );
  const events = await service.list(personId(1));
  assert.ok(events.some((e) => e.id === dinnerId(1)));
  assert.ok(!events.some((e) => e.id === dinnerId(2)));
});
test("reader role cannot write records or read profile contact information", async (t) => {
  const { db } = await fixture(t);
  await assert.rejects(
    () => db.query("SELECT phone_number FROM dinner_app.profiles"),
    /permission denied/,
  );
  await assert.rejects(
    () => db.query("UPDATE dinner_app.registrations SET status='cancelled'"),
    /permission denied/,
  );
});

test("invalid connection settings never repeat a database password in the error", () => {
  assert.throws(
    () =>
      new PostgresRepository({ connectionString: "secret-password not a URL" }),
    (error) =>
      error.message.includes("DATABASE_URL") &&
      !error.message.includes("secret-password"),
  );
});
test("connection-string sslmode cannot weaken certificate verification", async () => {
  const repo = new PostgresRepository({
    connectionString:
      "postgresql://reader:example@localhost/test?sslmode=require",
  });
  assert.equal(repo.pool.options.ssl.rejectUnauthorized, true);
  assert.doesNotMatch(repo.pool.options.connectionString, /sslmode/);
  await repo.close();
});

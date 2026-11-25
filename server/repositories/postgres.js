import pg from "pg";
import { readFileSync } from "node:fs";
// Queries only load records. Counts, statuses and dietary aggregation are JS.
export const EVENT_COLUMNS =
  "id,host_id,title,topic_category,description,address,starts_at,ends_at,signup_deadline,guest_capacity,status";
export class PostgresRepository {
  constructor({ connectionString, ssl = true, caFile, pool } = {}) {
    if (!pool) {
      let parsed;
      try {
        parsed = new URL(connectionString);
      } catch {
        throw new Error(
          "DATABASE_URL must be a valid PostgreSQL connection string.",
        );
      }
      if (!["postgres:", "postgresql:"].includes(parsed.protocol))
        throw new Error("Use a PostgreSQL database connection string.");
      // pg connection-string SSL options otherwise replace the explicit TLS config.
      for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"])
        parsed.searchParams.delete(key);
      connectionString = parsed.toString();
    }
    this.pool =
      pool ||
      new pg.Pool({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 8000,
        idleTimeoutMillis: 30000,
        ssl: ssl
          ? {
              rejectUnauthorized: true,
              ...(caFile ? { ca: readFileSync(caFile, "utf8") } : {}),
            }
          : false,
      });
    this.pool.on?.("error", () =>
      console.error("Database connection was interrupted."),
    );
  }
  async hosts(ids) {
    const { rows } = await this.pool.query(
      "SELECT id,full_name FROM dinner_app.profiles WHERE id=ANY($1::uuid[]) ORDER BY full_name",
      [ids],
    );
    return rows;
  }
  async read(hostId, eventId) {
    const client = await this.pool.connect();
    try {
      // A consistent snapshot prevents concurrent sign-ups from producing
      // different counts and roster contents within the same API response.
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const { rows: events } = await client.query(
        `SELECT ${EVENT_COLUMNS} FROM dinner_app.dinners
        WHERE host_id=$1${eventId ? " AND id=$2" : ""} ORDER BY starts_at,id`,
        eventId ? [hostId, eventId] : [hostId],
      );
      let rows = [];
      if (events.length)
        ({ rows } = await client.query(
          `SELECT r.id,r.dinner_id,r.student_id,r.status,r.family_seats,
        r.dietary_notes,r.family_dietary_notes,r.created_at,p.full_name
        FROM dinner_app.registrations r JOIN dinner_app.profiles p ON p.id=r.student_id
        WHERE r.dinner_id=ANY($1::uuid[]) ORDER BY r.created_at,r.id`,
          [events.map((e) => e.id)],
        ));
      await client.query("COMMIT");
      return events.map((event) => ({
        event,
        registrations: rows.filter((r) => r.dinner_id === event.id),
      }));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async snapshot(eventId, hostId) {
    return (await this.read(hostId, eventId))[0] || null;
  }
  async listSnapshots(hostId) {
    return this.read(hostId);
  }
  async close() {
    await this.pool.end();
  }
}

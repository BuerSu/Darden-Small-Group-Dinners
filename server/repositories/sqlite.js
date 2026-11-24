import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { makeDemoData, DEMO_HOST_IDS, demoDiet } from "../demo-data.js";
import { AppError } from "../errors.js";
export class SqliteRepository {
  constructor(filename = "data/host-dashboard.sqlite") {
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,full_name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dinners(id TEXT PRIMARY KEY,host_id TEXT NOT NULL REFERENCES profiles(id),
        title TEXT NOT NULL,topic_category TEXT NOT NULL,description TEXT NOT NULL,address TEXT NOT NULL,
        starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,signup_deadline TEXT NOT NULL,
        guest_capacity INTEGER NOT NULL CHECK(guest_capacity>=3),status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,dinner_id TEXT NOT NULL REFERENCES dinners(id),
        student_id TEXT NOT NULL REFERENCES profiles(id),status TEXT NOT NULL,family_seats INTEGER NOT NULL CHECK(family_seats>=0),
        dietary_notes TEXT NOT NULL,family_dietary_notes TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(dinner_id,student_id));`);
    if (!this.db.prepare("SELECT id FROM dinners LIMIT 1").get()) this.seed();
  }
  seed() {
    const fixtures = makeDemoData();
    this.db.exec("BEGIN");
    try {
      for (const table of ["profiles", "dinners", "registrations"])
        for (const row of fixtures[table]) {
          const keys = Object.keys(row);
          this.db
            .prepare(
              `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
            )
            .run(...Object.values(row));
        }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async hosts(ids = DEMO_HOST_IDS) {
    if (!ids.length) return [];
    return this.db
      .prepare(
        `SELECT id,full_name FROM profiles WHERE id IN(${ids.map(() => "?").join(",")}) ORDER BY full_name`,
      )
      .all(...ids);
  }
  readSnapshot(id, hostId) {
    const event = this.db
      .prepare("SELECT * FROM dinners WHERE id=? AND host_id=?")
      .get(id, hostId);
    if (!event) return null;
    const registrations = this.db
      .prepare(
        `SELECT r.*,p.full_name FROM registrations r
      JOIN profiles p ON p.id=r.student_id WHERE r.dinner_id=? ORDER BY r.created_at,r.id`,
      )
      .all(id);
    return { event, registrations };
  }
  async snapshot(id, hostId) {
    return this.readSnapshot(id, hostId);
  }
  async listSnapshots(hostId) {
    return this.db
      .prepare("SELECT id FROM dinners WHERE host_id=? ORDER BY starts_at,id")
      .all(hostId)
      .map((row) => this.readSnapshot(row.id, hostId));
  }
  mutateDemo(eventId, hostId, plan) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const snapshot = this.readSnapshot(eventId, hostId);
      const { action, familySeats } = plan(snapshot);
      const active = snapshot.registrations.filter(
        (r) => r.status !== "cancelled",
      );
      if (action === "add") {
        const people = this.db
          .prepare("SELECT * FROM profiles WHERE id<>? ORDER BY id")
          .all(hostId);
        const person = people.find(
          (p) => !active.some((r) => r.student_id === p.id),
        );
        if (!person)
          throw new AppError(
            409,
            "DEMO_POOL_EXHAUSTED",
            "All sample students are already registered.",
          );
        const old = snapshot.registrations.find(
          (r) => r.student_id === person.id,
        );
        const notes = demoDiet[people.indexOf(person) % demoDiet.length];
        this.db
          .prepare(
            `INSERT INTO registrations(id,dinner_id,student_id,status,family_seats,dietary_notes,family_dietary_notes,created_at)
          VALUES(?,?,?,'reserved',?,?,?,?) ON CONFLICT(dinner_id,student_id) DO UPDATE SET
          status='reserved',family_seats=excluded.family_seats,dietary_notes=excluded.dietary_notes,
          family_dietary_notes=excluded.family_dietary_notes,created_at=excluded.created_at`,
          )
          .run(
            old?.id || randomUUID(),
            eventId,
            person.id,
            familySeats,
            notes,
            "",
            new Date().toISOString(),
          );
      } else if (action === "cancel" && active.length) {
        this.db
          .prepare("UPDATE registrations SET status='cancelled' WHERE id=?")
          .run(active.at(-1).id);
      } else if (action === "reset") {
        this.db
          .prepare(
            "UPDATE registrations SET status='cancelled' WHERE dinner_id=? AND status='reserved'",
          )
          .run(eventId);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async close() {
    this.db.close();
  }
}

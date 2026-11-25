import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDinner, StatusService } from "../server/status-service.js";
const now = new Date("2026-11-23T12:00:00Z");
const event = {
  id: "dinner",
  host_id: "host",
  title: "Dinner",
  topic_category: "Other",
  description: "",
  address: "Address",
  starts_at: "2026-11-25T23:00:00Z",
  ends_at: "2026-11-26T01:00:00Z",
  signup_deadline: "2026-11-25T12:00:00Z",
  guest_capacity: 6,
  status: "open",
};
const registration = (n, extra = {}) => ({
  id: `r${n}`,
  student_id: `u${n}`,
  full_name: `Student ${n}`,
  status: "reserved",
  family_seats: 0,
  dietary_notes: "",
  family_dietary_notes: "",
  ...extra,
});
test("zero sign-ups has empty roster and all seats available", () => {
  const r = summarizeDinner(event, [], now);
  assert.equal(r.display.status, "no_signups");
  assert.equal(r.summary.seats_remaining, 6);
  assert.deepEqual(r.roster, []);
});
test("family seats consume capacity but not student minimum", () => {
  const r = summarizeDinner(event, [registration(1, { family_seats: 2 })], now);
  assert.equal(r.summary.student_signups, 1);
  assert.equal(r.summary.seats_reserved, 3);
  assert.equal(r.summary.participation_met, false);
  assert.equal(r.display.status, "needs_more");
});
test("three students meet minimum with capacity still available", () => {
  const r = summarizeDinner(
    event,
    [1, 2, 3].map((n) => registration(n)),
    now,
  );
  assert.equal(r.display.status, "confirmed");
  assert.equal(r.summary.participation_met, true);
});
test("full capacity is distinct from participation minimum", () => {
  const r = summarizeDinner(event, [registration(1, { family_seats: 5 })], now);
  assert.equal(r.display.status, "full");
  assert.equal(r.summary.is_full, true);
  assert.equal(r.summary.participation_met, false);
  assert.match(r.display.message, /only 1 student/);
});
test("full event with three students reports minimum met", () => {
  const r = summarizeDinner(
    { ...event, guest_capacity: 4 },
    [registration(1, { family_seats: 1 }), registration(2), registration(3)],
    now,
  );
  assert.equal(r.summary.seats_reserved, 4);
  assert.equal(r.summary.seats_remaining, 0);
  assert.equal(r.display.status, "full");
  assert.equal(r.summary.participation_met, true);
});
test("cancelled registrations contribute no seats, names or dietary notes", () => {
  const r = summarizeDinner(
    event,
    [
      registration(1, {
        status: "cancelled",
        dietary_notes: "Nut allergy",
        family_seats: 3,
      }),
    ],
    now,
  );
  assert.equal(r.summary.seats_reserved, 0);
  assert.deepEqual(r.dietary_summary.student_notes, []);
});
test("dietary notes preserve exact content, deduplicate, and separate family reports", () => {
  const r = summarizeDinner(
    event,
    [
      registration(1, {
        dietary_notes: "Vegan",
        family_seats: 1,
        family_dietary_notes: "Nut allergy; avoid cross-contact",
      }),
      registration(2, { dietary_notes: " vegan " }),
      registration(3, { family_seats: 1 }),
    ],
    now,
  );
  assert.deepEqual(r.dietary_summary.student_notes, [
    { note: "Vegan", registrations: 2 },
  ]);
  assert.deepEqual(r.dietary_summary.family_notes, [
    { note: "Nut allergy; avoid cross-contact", registrations: 1 },
  ]);
  assert.equal(r.dietary_summary.family_parties_missing_notes, 1);
});
test("cancelled and completed event states override sign-up badge", () => {
  const rows = [1, 2, 3].map((n) => registration(n));
  assert.equal(
    summarizeDinner({ ...event, status: "cancelled" }, rows, now).display
      .status,
    "cancelled",
  );
  assert.equal(
    summarizeDinner({ ...event, status: "completed" }, rows, now).display
      .status,
    "completed",
  );
});
test("closed, ended and over-capacity records are presented explicitly", () => {
  assert.equal(
    summarizeDinner(
      { ...event, signup_deadline: "2026-11-22T00:00:00Z" },
      [],
      now,
    ).display.status,
    "closed",
  );
  assert.equal(
    summarizeDinner(event, [], new Date("2026-11-27T00:00:00Z")).display.status,
    "ended",
  );
  const over = summarizeDinner(
    event,
    [registration(1, { family_seats: 7 })],
    now,
  );
  assert.equal(over.display.status, "over_capacity");
  assert.equal(over.summary.seats_remaining, 0);
  assert.equal(over.summary.occupancy_percent, 100);
});
test("completed event retains attendance outcomes and counts", () => {
  const r = summarizeDinner(
    { ...event, status: "completed" },
    [
      registration(1, { status: "attended" }),
      registration(2, { status: "no_show" }),
      registration(3, { status: "excused" }),
    ],
    now,
  );
  assert.equal(r.summary.student_signups, 3);
  assert.equal(r.roster[1].status, "no_show");
});
test("service rejects another host even if a repository returns an unfiltered event", async () => {
  const service = new StatusService({
    snapshot: async () => ({ event, registrations: [] }),
  });
  await assert.rejects(
    () => service.get("attacker", "dinner"),
    (e) => e.status === 404,
  );
});
test("service denies demo mutation when using a read-only repository", async () => {
  await assert.rejects(
    () => new StatusService({}).simulate("host", "dinner", "add"),
    (e) => e.status === 404,
  );
});

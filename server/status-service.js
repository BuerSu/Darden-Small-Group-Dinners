import { AppError, notFound } from "./errors.js";
export const MIN_STUDENTS = 3;
const includedStatuses = new Set([
  "reserved",
  "attended",
  "no_show",
  "excused",
]);
function uniqueNotes(rows, field) {
  const grouped = new Map();
  for (const row of rows) {
    const note = (row[field] || "").trim();
    if (!note) continue;
    const key = note.replace(/\s+/g, " ").toLowerCase();
    const entry = grouped.get(key) || { note, registrations: 0 };
    entry.registrations += 1;
    grouped.set(key, entry);
  }
  return [...grouped.values()].sort((a, b) => a.note.localeCompare(b.note));
}
/** All user-story rules live here, independently of database/UI technology. */
export function summarizeDinner(event, rows, now = new Date()) {
  const roster = rows
    .filter((r) => includedStatuses.has(r.status))
    .map((r) => ({
      registration_id: r.id,
      student_id: r.student_id,
      full_name: r.full_name,
      status: r.status,
      family_seats: Number(r.family_seats),
      party_size: 1 + Number(r.family_seats),
      dietary_notes: r.dietary_notes || "",
      family_dietary_notes: r.family_dietary_notes || "",
    }));
  const students = roster.length;
  const family = roster.reduce((n, r) => n + r.family_seats, 0);
  const seats = students + family;
  const capacity = Number(event.guest_capacity);
  const minimumMet = students >= MIN_STUDENTS;
  const isFull = seats >= capacity;
  const closed = new Date(event.signup_deadline) <= now;
  const ended = new Date(event.ends_at) <= now;
  let status, label, tone, message;
  if (event.status === "cancelled") {
    [status, label, tone, message] = [
      "cancelled",
      "Cancelled",
      "danger",
      "This dinner is cancelled. The roster is retained for reference.",
    ];
  } else if (event.status === "completed") {
    [status, label, tone, message] = [
      "completed",
      "Completed",
      "neutral",
      "This dinner has finished. The roster includes the recorded attendance outcomes.",
    ];
  } else if (ended) {
    [status, label, tone, message] = [
      "ended",
      "Event ended",
      "neutral",
      "This dinner has ended. Review the roster before completing attendance check-in.",
    ];
  } else if (seats > capacity) {
    [status, label, tone, message] = [
      "over_capacity",
      "Over capacity",
      "danger",
      "More seats are reserved than available. Review the reservations before this dinner.",
    ];
  } else if (isFull) {
    [status, label, tone, message] = [
      "full",
      "Fully booked",
      "danger",
      minimumMet
        ? `All ${capacity} guest seats are reserved and the three-student minimum is met.`
        : `All ${capacity} guest seats are reserved, but only ${students} student sign-up${students === 1 ? "" : "s"} ${students === 1 ? "is" : "are"} registered. Family seats do not satisfy the three-student minimum.`,
    ];
  } else if (closed) {
    [status, label, tone, message] = [
      "closed",
      "Sign-ups closed",
      minimumMet ? "success" : "warning",
      minimumMet
        ? "The sign-up deadline has passed and the minimum participation requirement is met."
        : "The sign-up deadline has passed without three student registrations. This dinner needs review.",
    ];
  } else if (students === 0) {
    [status, label, tone, message] = [
      "no_signups",
      "No sign-ups",
      "neutral",
      "Waiting for sign-ups. At least three students must register for this dinner to move ahead.",
    ];
  } else if (!minimumMet) {
    const missing = MIN_STUDENTS - students;
    [status, label, tone, message] = [
      "needs_more",
      "Needs more guests",
      "warning",
      `${missing} more student sign-up${missing === 1 ? "" : "s"} needed for this dinner to move ahead.`,
    ];
  } else {
    [status, label, tone, message] = [
      "confirmed",
      "Minimum met",
      "success",
      "At least three students have signed up. The minimum is currently met; cancellations can change this.",
    ];
  }
  const familyRows = roster.filter((r) => r.family_seats > 0);
  return {
    event: {
      id: event.id,
      title: event.title,
      topic_category: event.topic_category,
      description: event.description,
      address: event.address,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      signup_deadline: event.signup_deadline,
      guest_capacity: capacity,
      status: event.status,
    },
    summary: {
      student_signups: students,
      family_seats: family,
      seats_reserved: seats,
      seats_remaining: Math.max(0, capacity - seats),
      capacity,
      occupancy_percent: Math.min(100, Math.round((seats / capacity) * 100)),
      minimum_students: MIN_STUDENTS,
      participation_met: minimumMet,
      is_full: isFull,
      over_capacity: seats > capacity,
      signup_deadline_passed: closed,
      signup_open: event.status === "open" && !closed && !ended && !isFull,
    },
    display: { status, label, tone, message },
    roster,
    dietary_summary: {
      student_notes: uniqueNotes(roster, "dietary_notes"),
      family_notes: uniqueNotes(familyRows, "family_dietary_notes"),
      family_parties_missing_notes: familyRows.filter(
        (r) => !r.family_dietary_notes.trim(),
      ).length,
    },
    updated_at: now.toISOString(),
  };
}
export class StatusService {
  constructor(repository, clock = () => new Date()) {
    this.repository = repository;
    this.clock = clock;
  }
  async list(hostId) {
    return (await this.repository.listSnapshots(hostId)).map(
      ({ event, registrations }) => {
        if (event.host_id !== hostId) throw notFound();
        const result = summarizeDinner(event, registrations, this.clock());
        return {
          ...result.event,
          summary: result.summary,
          display: result.display,
        };
      },
    );
  }
  async get(hostId, eventId) {
    const snapshot = await this.repository.snapshot(eventId, hostId);
    if (!snapshot || snapshot.event.host_id !== hostId) throw notFound();
    return summarizeDinner(
      snapshot.event,
      snapshot.registrations,
      this.clock(),
    );
  }
  async simulate(hostId, eventId, action, familySeats = 0) {
    if (!this.repository.mutateDemo)
      throw new AppError(
        404,
        "NOT_FOUND",
        "Demo controls are unavailable for this database.",
      );
    if (!["add", "cancel", "reset"].includes(action))
      throw new AppError(400, "INVALID_ACTION", "Choose add, cancel or reset.");
    if (!Number.isInteger(familySeats) || familySeats < 0 || familySeats > 8)
      throw new AppError(
        400,
        "INVALID_FAMILY_SEATS",
        "Choose a whole number from zero to eight family seats.",
      );
    this.repository.mutateDemo(eventId, hostId, (snapshot) => {
      if (!snapshot || snapshot.event.host_id !== hostId) throw notFound();
      const state = summarizeDinner(
        snapshot.event,
        snapshot.registrations,
        this.clock(),
      );
      if (
        snapshot.event.status !== "open" ||
        new Date(snapshot.event.signup_deadline) <= this.clock()
      ) {
        throw new AppError(
          409,
          "CLOSED",
          "Choose an open future dinner to use the demo controls.",
        );
      }
      if (action === "add" && state.summary.seats_remaining < 1 + familySeats) {
        throw new AppError(
          409,
          "CAPACITY_REACHED",
          "There are not enough seats for this party.",
        );
      }
      return { action, familySeats };
    });
    return this.get(hostId, eventId);
  }
}

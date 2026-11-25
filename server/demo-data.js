const uuid = (group, n) =>
  `d4de0000-${group}-4000-8000-${String(n).padStart(12, "0")}`;
export const personId = (n) => uuid("1000", n);
export const dinnerId = (n) => uuid("2000", n);
export const DEMO_HOST_IDS = [1, 14, 11, 16].map(personId);
export function makeDemoData(now = new Date()) {
  const names = [
    "Maya Chen",
    "Arjun Rao",
    "Priya Shah",
    "Lucas Martin",
    "Sara Ahmed",
    "Ethan Brooks",
    "Ava Williams",
    "Noah Davis",
    "Mia Patel",
    "Leo Garcia",
    "Zoe Kim",
    "Owen Wilson",
    "Isha Mehta",
    "Ben Thompson",
    "Hana Park",
    "Sam Rivera",
    "Tara Singh",
    "Dev Kapoor",
    "Nina Lopez",
    "Alex Morgan",
  ];
  const profiles = names.map((full_name, i) => ({
    id: personId(i + 1),
    full_name,
  }));
  const specs = [
    [
      1,
      1,
      "Career switches over supper",
      "Career & Professional Life",
      3,
      6,
      "open",
    ],
    [
      2,
      14,
      "Food and culture exchange",
      "Culture & Global Perspectives",
      5,
      4,
      "open",
    ],
    [
      3,
      1,
      "Books that changed our minds",
      "Ideas, Books & Current Events",
      7,
      6,
      "open",
    ],
    [4, 1, "Hobbies beyond the case method", "Interests", 9, 6, "open"],
    [
      5,
      1,
      "A cancelled community supper",
      "Life & Connection",
      4,
      6,
      "cancelled",
    ],
    [8, 1, "Family seats and the student minimum", "Other", 8, 6, "open"],
    [104, 16, "Sam hosted a dinner", "Life & Connection", -3, 6, "completed"],
    [
      401,
      11,
      "Zoe dinner awaiting check-in",
      "Darden & MBA Life",
      -1,
      6,
      "open",
    ],
  ];
  const time = (days) =>
    new Date(now.getTime() + days * 86400000).toISOString();
  const dinners = specs.map(
    ([n, host, title, topic_category, days, guest_capacity, status]) => ({
      id: dinnerId(n),
      host_id: personId(host),
      title,
      topic_category,
      description:
        "A small gathering to meet classmates beyond your usual circle.",
      address: `Fictional demo location ${n}, Charlottesville`,
      starts_at: time(days),
      ends_at: time(days + 2 / 24),
      signup_deadline: time(days - 1),
      guest_capacity,
      status,
    }),
  );
  const regs = [
    [1, 5, 0, "Vegan", ""],
    [1, 6, 0, "Nut allergy: avoid cross-contact", ""],
    [1, 3, 2, "Vegetarian", "Partner is pescatarian; child has a nut allergy."],
    [2, 4, 1, "", ""],
    [2, 7, 0, "Pescatarian", ""],
    [2, 17, 0, "", ""],
    [4, 16, 0, "", ""],
    [4, 15, 0, "", ""],
    [8, 2, 5, "Vegetarian", ""],
    [5, 2, 0, "", ""],
    [5, 16, 0, "", ""],
    [104, 2, 0, "Vegetarian", ""],
    [104, 3, 0, "", ""],
    [104, 5, 0, "Vegan", ""],
    [401, 2, 0, "Vegetarian", ""],
    [401, 18, 0, "", ""],
    [401, 19, 0, "", ""],
  ].map(
    (
      [event, person, family_seats, dietary_notes, family_dietary_notes],
      i,
    ) => ({
      id: uuid("3000", event * 100 + person),
      dinner_id: dinnerId(event),
      student_id: personId(person),
      status: event === 104 ? "attended" : "reserved",
      family_seats,
      dietary_notes,
      family_dietary_notes,
      created_at: new Date(now.getTime() - (100 - i) * 60000).toISOString(),
    }),
  );
  return { profiles, dinners, registrations: regs };
}
export const demoDiet = [
  "Vegetarian",
  "Gluten restriction",
  "",
  "Nut allergy",
  "",
  "Vegan",
];

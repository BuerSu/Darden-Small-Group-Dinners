const $ = (id) => document.getElementById(id);
let config,
  hostId = "",
  selectedId = "",
  list = [],
  current = null,
  requestVersion = 0;
let busy = false,
  pollTimer;
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const formatDate = (value) => dateFormatter.format(new Date(value));
const text = (tag, content, className) => {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
};
function errorMessage(message = "") {
  $("errorMessage").textContent = message;
  $("errorMessage").hidden = !message;
  $("retryButton").hidden = !message || !$("loginSection").hidden;
}
function loginVisible(show) {
  $("loginSection").hidden = !show;
  $("logoutButton").hidden = show || config?.auth_mode !== "supabase";
  $("retryButton").hidden = show || !$("errorMessage").textContent;
}
async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (config?.auth_mode === "demo") headers["X-Demo-Host-Id"] = hostId;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    ...options,
    headers,
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(12000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "The server returned an unreadable response. Try refreshing.",
    );
  }
  if (!response.ok) {
    const error = new Error(
      result.error?.message || "Unable to load dinner information.",
    );
    error.status = response.status;
    throw error;
  }
  return result;
}
function setBusy(value) {
  busy = value;
  for (const id of [
    "refreshButton",
    "hostSelect",
    "eventSelect",
    "addButton",
    "cancelButton",
    "resetButton",
    "familySeats",
  ])
    $(id).disabled = value;
  if (!value && current) updateDemoControls();
}
function updateDemoControls() {
  if (!current) return;
  const open =
    current.event.status === "open" && !current.summary.signup_deadline_passed;
  $("demoUnavailable").hidden = open;
  const required = 1 + Number($("familySeats").value);
  $("addButton").disabled =
    busy || !open || current.summary.seats_remaining < required;
  $("cancelButton").disabled =
    busy || !open || current.summary.student_signups === 0;
  $("resetButton").disabled =
    busy || !open || current.summary.student_signups === 0;
}
function renderDietary(summary) {
  const container = $("dietarySummary");
  container.replaceChildren();
  for (const [title, notes] of [
    ["Students", summary.student_notes],
    ["Family members", summary.family_notes],
  ]) {
    if (!notes.length) continue;
    const group = text("div", "", "diet-group");
    group.append(text("h3", title));
    const ul = document.createElement("ul");
    for (const entry of notes) {
      const li = text("li", entry.note);
      li.append(
        text(
          "span",
          `${entry.registrations} booking${entry.registrations === 1 ? "" : "s"} reporting this note`,
          "diet-count",
        ),
      );
      ul.append(li);
    }
    group.append(ul);
    container.append(group);
  }
  if (!summary.student_notes.length && !summary.family_notes.length)
    container.append(
      text(
        "p",
        "No dietary restrictions reported for this dinner.",
        "small subtle",
      ),
    );
  if (summary.family_parties_missing_notes)
    container.append(
      text(
        "p",
        `${summary.family_parties_missing_notes} family ${summary.family_parties_missing_notes === 1 ? "party has" : "parties have"} no dietary details provided.`,
        "family-note",
      ),
    );
}
function render(data) {
  current = data;
  const { event, summary, display, roster } = data;
  $("eventTheme").textContent = event.title;
  $("eventCategory").textContent = event.topic_category;
  $("eventDate").textContent = formatDate(event.starts_at);
  $("eventAddress").textContent = event.address;
  $("eventDescription").textContent = event.description;
  $("eventDescription").hidden = !event.description;
  $("statusBadge").className = `badge ${display.tone}`;
  $("statusBadge").textContent = display.label;
  $("statusBanner").className = `alert ${display.tone}`;
  $("statusBanner").textContent = display.message;
  $("studentCount").textContent = summary.student_signups;
  $("familyCount").textContent = summary.family_seats;
  $("seatsLeft").textContent = summary.seats_remaining;
  $("capacityCounterText").textContent =
    `${summary.seats_reserved} / ${summary.capacity} reserved`;
  $("capacityProgress").value = summary.occupancy_percent;
  $("capacityProgress").textContent = `${summary.occupancy_percent}%`;
  $("deadlineText").textContent =
    `Sign-up deadline: ${formatDate(event.signup_deadline)}`;
  $("rosterCountTag").textContent =
    `${roster.length} student${roster.length === 1 ? "" : "s"} · ${summary.seats_reserved} seats`;
  $("rosterList").replaceChildren();
  $("rosterEmpty").hidden = roster.length > 0;
  for (const person of roster) {
    const li = text("li", "", "roster-person");
    const heading = text("div", "", "person-heading");
    heading.append(
      text("strong", person.full_name),
      text(
        "span",
        `${person.party_size} seat${person.party_size === 1 ? "" : "s"}${person.family_seats ? ` · ${person.family_seats} family` : ""}`,
        "party-label",
      ),
    );
    li.append(
      heading,
      text(
        "p",
        `Student: ${person.dietary_notes.trim() || "No dietary restrictions reported."}`,
      ),
    );
    if (person.family_seats)
      li.append(
        text(
          "p",
          `Family: ${person.family_dietary_notes.trim() || "Dietary details not provided."}`,
        ),
      );
    if (person.status !== "reserved")
      li.append(text("span", person.status.replaceAll("_", " "), "attendance"));
    $("rosterList").append(li);
  }
  renderDietary(data.dietary_summary);
  $("demoControls").hidden = !config.simulation_available;
  $("dashboard").hidden = false;
  $("emptyState").hidden = true;
  $("lastUpdated").textContent =
    `Updated ${new Date(data.updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · Refreshes every 15 seconds`;
  updateDemoControls();
}
async function refresh({ poll = false } = {}) {
  if (busy || $("loginSection").hidden === false) return;
  const version = ++requestVersion;
  if (!poll) {
    setBusy(true);
    errorMessage();
    $("loadingMessage").hidden = false;
  }
  try {
    const result = await api("/api/host/dinners");
    if (version !== requestVersion) return;
    list = result.dinners;
    if (!list.some((d) => d.id === selectedId))
      selectedId =
        list.find(
          (d) => d.status === "open" && new Date(d.ends_at) > new Date(),
        )?.id ||
        list[0]?.id ||
        "";
    const focused = document.activeElement === $("eventSelect");
    // Avoid replacing an open native select while the host is choosing an event.
    if (!poll || !focused) {
      $("eventSelect").replaceChildren(
        ...list.map((d) => {
          const option = text("option", `${d.title} — ${d.display.label}`);
          option.value = d.id;
          return option;
        }),
      );
      $("eventSelect").value = selectedId;
    }
    $("selectionSection").hidden = false;
    if (!selectedId) {
      current = null;
      $("dashboard").hidden = true;
      $("emptyState").hidden = false;
      return;
    }
    const data = await api(`/api/host/dinners/${selectedId}/status`);
    if (version !== requestVersion) return;
    render(data);
    errorMessage();
    loginVisible(false);
  } catch (error) {
    if (version !== requestVersion) return;
    errorMessage(
      error.name === "TimeoutError"
        ? "The request timed out. Please try again."
        : error.message,
    );
    if (error.status === 401 && config.auth_mode === "supabase") {
      loginVisible(true);
      $("dashboard").hidden = true;
      $("selectionSection").hidden = true;
      current = null;
    } else if (!poll) {
      $("dashboard").hidden = true;
      $("emptyState").hidden = true;
      current = null;
    }
  } finally {
    if (version === requestVersion) {
      $("loadingMessage").hidden = true;
      setBusy(false);
    }
  }
}
async function simulate(action) {
  if (busy || !selectedId) return;
  const version = ++requestVersion;
  setBusy(true);
  errorMessage();
  let failed = false;
  try {
    const data = await api(`/api/host/dinners/${selectedId}/demo`, {
      method: "POST",
      body: JSON.stringify({
        action,
        family_seats: Number($("familySeats").value),
      }),
    });
    if (version === requestVersion) render(data);
  } catch (error) {
    failed = true;
    if (version === requestVersion) errorMessage(error.message);
  } finally {
    if (version === requestVersion) {
      setBusy(false);
      if (!failed) await refresh();
    }
  }
}
$("eventSelect").addEventListener("change", () => {
  selectedId = $("eventSelect").value;
  current = null;
  refresh();
});
$("hostSelect").addEventListener("change", () => {
  ++requestVersion;
  busy = false;
  hostId = $("hostSelect").value;
  selectedId = "";
  current = null;
  $("dashboard").hidden = true;
  refresh();
});
$("familySeats").addEventListener("change", updateDemoControls);
$("refreshButton").addEventListener("click", () => refresh());
$("retryButton").addEventListener("click", () =>
  config ? refresh() : start(),
);
$("addButton").addEventListener("click", () => simulate("add"));
$("cancelButton").addEventListener("click", () => simulate("cancel"));
$("resetButton").addEventListener("click", () => simulate("reset"));
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginButton").disabled = true;
  errorMessage();
  try {
    await api("/api/session", {
      method: "POST",
      body: JSON.stringify({
        email: $("email").value,
        password: $("password").value,
      }),
    });
    $("password").value = "";
    loginVisible(false);
    await refresh();
  } catch (error) {
    errorMessage(error.message);
  } finally {
    $("loginButton").disabled = false;
  }
});
$("logoutButton").addEventListener("click", async () => {
  ++requestVersion;
  busy = false;
  try {
    await api("/api/session", { method: "DELETE" });
    current = null;
    selectedId = "";
    loginVisible(true);
    $("dashboard").hidden = true;
    $("selectionSection").hidden = true;
    errorMessage();
  } catch (error) {
    errorMessage(error.message);
  }
});
async function start() {
  try {
    config = await api("/api/config");
    if (config.auth_mode === "demo") {
      $("modeNote").textContent =
        config.data_source === "supabase"
          ? "Local preview · Connected to Supabase · Choose a seeded host below."
          : "Local demo · Sample sign-ups are saved on this computer.";
      $("modeNote").hidden = false;
      $("hostField").hidden = false;
      $("hostSelect").replaceChildren(
        ...config.demo_hosts.map((h) => {
          const option = text("option", h.full_name);
          option.value = h.id;
          return option;
        }),
      );
      hostId = config.demo_hosts[0]?.id || "";
      if (!hostId)
        throw new Error(
          "No demo hosts found. Check the seed data and DEMO_HOST_IDS configuration.",
        );
      $("hostSelect").value = hostId;
    }
    await refresh();
    pollTimer = setInterval(() => {
      if (!document.hidden && !busy) refresh({ poll: true });
    }, 15000);
  } catch (error) {
    errorMessage(error.message);
    $("loadingMessage").hidden = true;
  }
}
window.addEventListener("pagehide", () => clearInterval(pollTimer));
start();

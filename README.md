# Host sign-up status — Darden Small Group Dinners

A functioning implementation of the host dashboard from [PR #9](https://github.com/BuerSu/Darden-Small-Group-Dinners/pull/9), based on commit `cf4f88c`. It answers: **How many students and family members have signed up for my dinner, and what dietary requirements did they report?**

**The business logic is JavaScript, in `server/status-service.js`.** PostgreSQL/Supabase stores data; this feature does not call `host_roster`, `my_hosted_dinners`, or any other SQL/RPC business function. The preexisting functions can remain for other stories, but this dashboard never invokes them.

## Run immediately, without configuring Supabase or login

Install **Node.js 24+**, then from this repository:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:3000**. Keep the terminal running. Opening the HTML file directly will not run the backend.

The default is a persistent local SQLite demo with sample students, dinners and dietary notes. Choose a host and dinner. The optional demo buttons make real writes to `data/host-dashboard.sqlite`, so refreshes and server restarts retain the results. These buttons simulate registration changes for this story; they are not a full student-booking implementation.

To restore the local examples, stop the server, run `npm run demo:reset`, then `npm start`. This reset refuses to operate when a Supabase DATABASE_URL is configured.

## Connect your existing v2 Supabase schema and seed data

You have already installed the v2 schema and sample data. **Do not rerun a fresh-install script.**

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to a server-side PostgreSQL connection string for your Supabase project. The project's **Connect** panel supplies direct and pooler settings; use the connection appropriate to your network. A session pooler is useful if your network cannot reach the direct IPv6 endpoint. URL-encode special characters in the password. Never put this URL/password in frontend code or commit `.env`.
3. Keep `AUTH_MODE=demo` while login is deferred. This mode binds only to loopback and will not run with `NODE_ENV=production`. You can select seeded hosts without configuring actual password login. It is a local development mode, not something to deploy publicly.
4. Use a dedicated read-only database login for the server. Run `database/host_status_reader.sql` in Supabase SQL Editor as postgres; it creates a no-login reader role and grants read access to the required columns through RLS policies. Create a separate database login with a password, grant it membership in `dinner_dashboard_reader`, and use that login in DATABASE_URL. If your database login does not inherit roles, configure inheritance explicitly. For a quick development check, an existing privileged connection can also read the tables, but a restricted connection is preferable.
5. Keep `DATABASE_SSL=true` for hosted Supabase. TLS certificate verification is enabled. If your environment needs the project's CA certificate, set `DATABASE_CA_FILE` to its local file path. `sslmode` and client-certificate connection-string query parameters are removed so they cannot silently override this TLS configuration; configure TLS through the documented server settings. `DATABASE_SSL=false` is intended only for a trusted local PostgreSQL setup.
6. Restart `npm start`, open the dashboard, and select Maya, Ben, Zoe or Sam. The page indicates that it is connected to Supabase. Demo mutation buttons are absent when connected to PostgreSQL: existing registrations can be changed by your student-booking feature or the SQL Editor, then the dashboard refreshes from the actual records.

The optional SQL file is **access configuration only**. Its role/policy statements contain no sign-up counts, status rules, dietary aggregation or SQL business functions. It does not grant the browser's anon/authenticated roles access to the private schema.

### Host IDs if you used Auth-generated UUIDs

The default local preview host IDs match the SQL seed's deterministic IDs. If you created users with the earlier Auth-admin helper instead, the IDs will differ. In the Supabase SQL Editor, inspect the seeded hosts:

```sql
SELECT DISTINCT p.id, p.full_name
FROM dinner_app.profiles p
JOIN dinner_app.dinners d ON d.host_id = p.id
JOIN auth.users u ON u.id = p.id
WHERE u.raw_user_meta_data->>'seed_dataset' = 'darden_sgd_demo_v2'
ORDER BY p.full_name;
```

Set `DEMO_HOST_IDS` in `.env` to a comma-separated list of those UUIDs. This allowlist controls which sample identities are offered by the local preview. No Auth table read privilege is needed by the application itself.

## What the host sees

- Their own hosted dinners, selected from a dropdown.
- Student sign-up count, accompanying family seats, total seats reserved and seats remaining.
- A progress bar plus explicit empty, below-minimum, minimum-met, full, closed, ended, completed and cancelled states.
- One roster row per student booking, with party size, student dietary notes, family dietary notes and recorded attendance if applicable.
- Separate student/family dietary summaries grouped by matching reported text. Counts refer to **bookings reporting a note**, not inferred numbers of people with a medical condition.
- A warning when a family party has no dietary details, rather than assuming it has no restrictions.
- Loading, no-events, error, refresh and session-expiry handling. A visible page refreshes every 15 seconds; the Refresh button reads immediately.

The API is the source of all counts, eligibility-for-proceeding state and dietary summaries. Frontend JavaScript renders those results; it does not reimplement the three-student or capacity calculations.

### Rules for this user story

- The threshold is **three student registrations**; family members do not satisfy it.
- Capacity includes students and family members, excludes the host, and uses `1 + family_seats` per included booking.
- Cancelled registrations contribute neither names nor counts nor dietary notes.
- A completed event retains its attended/no_show/excused registration rows as historical sign-ups. A cancelled dinner's historical roster is still available to its host.
- A full dinner can still have too few students (for example, one student and five family members). Full capacity and minimum participation are reported independently.
- Minimum met is provisional; later cancellations can change it. This read feature does not automatically confirm/cancel the stored dinner or alter attendance.
- Dietary information comes from the **registration snapshots**, preserving requirements reported for that dinner. The current profile dietary form is not substituted later.
- Student and family notes are not interpreted as interchangeable or medically equivalent. Notes are grouped as text and remain visible in full.

This feature does not implement student signup eligibility, hosting credits, penalties, event creation, check-in submission, email delivery or all-account management. Existing flows may write the records this dashboard reads. Those business rules can be migrated to JavaScript/Python in separate stories without entangling this read-only dashboard.

## Backend design

The browser calls the Node API. Its JavaScript StatusService applies the rules to records supplied by a PostgreSQL or local SQLite repository.

| File                              | Responsibility                                                           |
| --------------------------------- | ------------------------------------------------------------------------ |
| `public/index.html`               | Accessible host dashboard adapted from PR #9                             |
| `public/styles.css`               | Local UVA orange/navy styles, responsive layout; no CDN required         |
| `public/dashboard.js`             | API requests, selection, refresh and safe text rendering                 |
| `server/app.js`                   | HTTP routes, validation, origin checks and safe errors                   |
| `server/status-service.js`        | Counts, status presentation, minimum, family and dietary rules           |
| `server/repositories/postgres.js` | Parameterized reads of existing v2 tables; consistent read-only snapshot |
| `server/repositories/sqlite.js`   | Persistent local demo storage and transactional simulation writes        |
| `server/auth.js`                  | Local demo identities or verification with Supabase Auth                 |
| `database/host_status_reader.sql` | Optional server database role/column privileges and RLS access policies  |
| `tests/`                          | Business logic, HTTP, ownership, database privileges and browser tests   |

The repository reads only `dinner_app.dinners`, `dinner_app.registrations`, and `dinner_app.profiles`. No additional tables are required in your Supabase project. The local demo deliberately uses only those three read-model tables and has no Auth dependency.

PostgreSQL reads an event and its registrations within one repeatable-read, read-only transaction. This keeps the counts and dietary roster consistent when someone signs up or cancels concurrently. The API authorizes the host before returning any participant information, and the queries constrain results to that host's dinners. Phone numbers, email addresses and unrelated profiles are not returned.

The database reader can read the permitted rows; **Node is the host-authorization boundary**. Its database credentials must remain server-side. The frontend cannot choose an arbitrary host in deployed Supabase-auth mode, even if it submits a fake preview header.

## API

| Method | Path                           | Result                                                   |
| ------ | ------------------------------ | -------------------------------------------------------- |
| GET    | `/api/config`                  | Mode and local preview hosts; no secrets                 |
| GET    | `/api/host/dinners`            | Current host's event list with summaries                 |
| GET    | `/api/host/dinners/:id/status` | Event, counts, status, roster and dietary summary        |
| POST   | `/api/host/dinners/:id/demo`   | Local SQLite simulation only: add/cancel/reset           |
| POST   | `/api/session`                 | Optional Darden email/password sign-in for Supabase mode |
| DELETE | `/api/session`                 | Clear this dashboard's session cookie                    |

Local API example:

```sh
curl -H "X-Demo-Host-Id: d4de0000-1000-4000-8000-000000000001" \
  http://127.0.0.1:3000/api/host/dinners/d4de0000-2000-4000-8000-000000000001/status
```

An event not owned by the caller returns 404, identical to an unknown event. Invalid input returns 400; insufficient local demo capacity returns 409; unavailable data returns 503 with no connection/password/query details. The list and detail endpoints are not cached in the browser or intermediary caches.

## Enable actual authentication later

For a deployed service, set:

```dotenv
AUTH_MODE=supabase
NODE_ENV=production
HOST=0.0.0.0
SECURE_COOKIES=true
DATABASE_URL=your_server_side_database_connection_string
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
```

Serve the application through HTTPS. The dashboard then displays a sign-in form. Supabase verifies email/password; the access token is held in an HttpOnly, SameSite=Strict, Secure cookie. Each API request verifies the token against Supabase's `/auth/v1/user` endpoint and uses the returned user ID. Only verified `@darden.virginia.edu` users may proceed. A Bearer token from another authenticated frontend is also supported. Demo headers and simulation routes do not bypass this verification.

This small dashboard stores no refresh token and asks the user to sign in again after access-token expiry (up to one hour). Sign out clears this dashboard's cookie; it does not revoke sessions in other applications. SQL-only fixture accounts do not support real password login; use actual Auth-created test accounts when testing this mode. No real Auth session or hosted database was available during implementation.

## Tests

```sh
npm test
npx playwright install chromium-headless-shell
npm run test:browser
```

The unit/integration suite covers the count/status rules, ownership, input validation, persistence, capacity failure/cancellation, safe errors, Auth verification, actual PostgreSQL queries against embedded PostgreSQL, the restricted reader's column/write permissions, and a DOM-based end-to-end flow that runs the frontend against the real HTTP server and SQLite database. Supabase network requests are mocked in Auth tests. PostgreSQL tests use an isolated three-table representation of the v2 read model; they do not call the old business functions.

Browser tests cover the complete page/API/database flow, host switching, dietary rendering, persistent sign-up changes, cancellation, full-versus-minimum behavior, XSS-resistant rendering, mobile overflow and browser errors. They save screenshots under `test-results/`. Set `CHROMIUM_PATH` to use a preinstalled compatible browser if needed.

The tests do not claim a live connection to your Supabase project, verify its installed policy configuration, or validate every concurrent production workload. Configure DATABASE_URL locally as discussed, then verify Maya's seeded event has three students, two family seats and five of six seats reserved; Ben's event is fully booked. Other stories that still call SQL functions are unchanged.

## Frontend compatibility

The old `Checking event status.html` file is now `public/index.html`. The server also serves the dashboard at `/Checking%20event%20status.html` so the original path works through the Node server. All original in-memory array simulation was replaced by HTTP-backed data. The dashboard has no dependency on Tailwind's CDN, so it renders with local assets in offline development.

### Validation in this workspace

The Node/PostgreSQL and DOM suites were executed locally. Full Playwright browser execution was blocked by this environment: installed Chromium could not create its process socket, the headless-shell download was denied, and the separate cloud browser could not connect to localhost. Browser tests are supplied for local execution; no visual/mobile screenshot result is claimed.

The full existing v2 fresh-install SQL and provided seed SQL were also loaded into embedded PostgreSQL and exercised through this repository's reader role and JavaScript service. Maya's three students/two family seats/five reserved seats, Ben's full dinner, Zoe's ended dinner, Sam's completed dinner and cross-host denial all matched the provided data. This verifies compatibility without a live hosted connection or SQL business-function calls. To reproduce with your SQL files:

```sh
node tests/v2-compatibility.mjs /path/to/00_fresh_install_v2.sql /path/to/01_seed_demo_data.sql
```

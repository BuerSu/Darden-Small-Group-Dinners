# Darden Small Group Dinners — Database Setup and Data Model

This pull request adds the **Supabase PostgreSQL database foundation** for Darden Small Group Dinners: six related tables and a development dataset.

**Business logic belongs in the application backend, written in JavaScript or Python.** These SQL scripts create storage, relationships, indexes and data-integrity constraints. They do **not** install application triggers, stored business functions or public RPC endpoints.

## What is included

| File | Purpose | When to run |
|---|---|---|
| [`database/00_schema_controller.sql`](database/00_schema_controller.sql) | Creates the `dinner_app` schema, six tables, indexes, constraints and access restrictions | Once, in a new Supabase project without the application schema |
| [`database/02_seed_controller_schema.sql`](database/02_seed_controller_schema.sql) | Inserts fictional users, profiles, dietary preferences, dinners, registrations, announcements and email-delivery examples | Optionally, after the schema script, in a development/test project |
| `README_data_model.md` | Setup instructions, table definitions, relationships and backend responsibilities | Reference |

The numbering is intentional: **there is no required `01` script in this PR**. Run `00`, then optionally `02`.

This PR does not include a frontend, controller/API implementation, authentication setup helper, database-reader role setup, scheduler or email worker. There is no `npm start` step for these database files alone.

## Quick start

### 1. Choose the correct project

Use a **new Supabase project** where `dinner_app` does not already exist. Supabase supplies the managed `auth.users` table referenced by this model.

If your team already shares a configured Supabase project, use its existing tables instead of rerunning the fresh-install script. Changes to an existing database need a reviewed migration; editing this file does not update installed objects.

### 2. Create the application tables

1. Open the project's **SQL Editor**.
2. Open `database/00_schema_controller.sql` from this repository.
3. Paste the entire file into the editor and execute it as `postgres` or the project administrator.
4. Confirm that it finishes successfully.
5. In the **Table Editor**, select the `dinner_app` schema to view the six application tables.

The script runs in one transaction. It is **not rerunnable**: it uses `CREATE SCHEMA` and `CREATE TABLE` rather than an upgrade migration. Do not run it on top of the previous database implementation.

### 3. Optionally load the development data

1. Open `database/02_seed_controller_schema.sql`.
2. Run the entire file in the same project's SQL Editor as the administrator.
3. Inspect the account/scenario list returned at the end.
4. Run the verification queries below to check the inserted records.

The seed explicitly creates missing profile rows and initializes fixture account states, so it does not depend on profile-creation or status-synchronization triggers.

### 4. Connect the backend separately

Configure your backend's server-side database connection and grant its database login only the access it needs. The schema script deliberately does **not** grant browser clients direct access. Keep database passwords and connection strings out of this repository and frontend code.

The host-status feature, for example, needs backend reads from `dinners`, `registrations` and `profiles`. Its service can calculate the sign-up count, reserved seats, minimum-participation state and dietary summary from those records.

## Architecture and scope

| Database responsibility | Backend/controller/service responsibility |
|---|---|
| Store records and relationships | Authenticate the caller and check ownership |
| Enforce primary/foreign keys and uniqueness | Decide whether a user can book or host |
| Reject structurally invalid values | Calculate hosting allowance and no-show penalties |
| Provide indexes for queries | Determine whether a dinner has enough student sign-ups |
| Store registration-specific dietary notes | Copy/confirm those notes when booking |
| Store announcements and delivery jobs | Create notices, select recipients and send emails |
| Store status/timestamp fields | Maintain status transitions and update timestamps |

The backend still uses SQL queries and transactions. Moving business decisions into JavaScript/Python does not remove the need to save related changes atomically or lock rows when concurrent requests could overbook a dinner.

## Table overview

All application tables are in the private `dinner_app` schema. Supabase Auth remains responsible for login credentials and its canonical email/confirmation records.

| Table | One row represents |
|---|---|
| `profiles` | One student's application profile |
| `dietary_preferences` | One student's answered dietary form |
| `dinners` | One dinner owned by one host |
| `registrations` | One student's booking, including accompanying family seats and attendance outcome |
| `dinner_updates` | One announcement or event-change/cancellation notice |
| `email_outbox` | One update to be delivered to one student |

A person can both host and attend dinners. Separate host accounts are unnecessary. Family members are represented by a seat count and notes on a registration; they do not need accounts or a separate guest table.

## Column reference

`PK` = primary key; `FK` = foreign key. All identifiers use `uuid`. Date/time columns use `timestamptz`. Columns are required unless marked nullable. Empty-string defaults are permitted by the SQL where shown; onboarding requirements must be enforced by the backend.

### `profiles`

| Column | Type | Constraint/default and meaning |
|---|---|---|
| `id` | `uuid` | PK and FK to `auth.users.id`; not independently generated |
| `full_name` | `text` | Default `''`; maximum 150 characters |
| `phone_number` | `text`, nullable | If supplied, international format such as `+14345550123` |
| `graduation_year` | `smallint`, nullable | Between 2000 and 2200 |
| `section` | `text`, nullable | Maximum 30 characters |
| `account_status` | `text` | Default `not_verified`; allowed: `active`, `suspended`, `not_verified` |
| `suspended_until` | `timestamptz`, nullable | Suspension expiry; available for the backend's penalty/reset logic |
| `created_at` | `timestamptz` | Default `now()` |

Email and email verification are read from `auth.users`; the model does not maintain a second editable email copy.

**There is no Auth-to-profile trigger.** Your backend must create/reconcile a profile for each Auth user who uses the application. Creating an Auth user alone does not automatically create this profile. The seed handles its own fixture profiles explicitly.

`account_status` is stored data, not an automatically calculated field. Confirming an email or reaching `suspended_until` does not update it by itself. The backend must apply the effective state and maintain the stored value when needed. Deleting an Auth user while a related profile exists is restricted by the foreign key.

### `dietary_preferences`

| Column | Type | Constraint/default and meaning |
|---|---|---|
| `profile_id` | `uuid` | PK and FK to `profiles.id`; at most one form per student |
| `is_vegan` | `boolean` | Default `false` |
| `is_vegetarian` | `boolean` | Default `false` |
| `is_pescatarian` | `boolean` | Default `false` |
| `has_nut_allergy` | `boolean` | Default `false` |
| `has_dairy_allergy` | `boolean` | Default `false` |
| `has_gluten_restriction` | `boolean` | Default `false` |
| `other_notes` | `text` | Default `''`; maximum 2,000 characters |
| `updated_at` | `timestamptz` | Default `now()` on insertion |

Convention: no row means the form is unanswered; an all-false row means none of the listed needs were selected. Flags can overlap. This small, fixed list keeps the model simple; a new flag requires a schema migration.

Deleting a profile cascades to its dietary-preference row. Other historical references can still prevent the profile itself from being deleted.

### `dinners`

| Column | Type | Constraint/default and meaning |
|---|---|---|
| `id` | `uuid` | PK; default `gen_random_uuid()` |
| `host_id` | `uuid` | FK to `profiles.id` |
| `title` | `text` | Nonblank; 1–200 characters |
| `topic_category` | `text` | Default `Other`; one of the categories below |
| `description` | `text` | Default `''`; maximum 5,000 characters |
| `address` | `text` | Nonblank; 1–1,000 characters |
| `arrival_instructions` | `text` | Default `''`; maximum 2,000 characters |
| `starts_at` | `timestamptz` | Dinner start |
| `ends_at` | `timestamptz` | Must be after `starts_at` |
| `signup_deadline` | `timestamptz` | Must be no later than `starts_at` |
| `guest_capacity` | `integer` | Must be greater than zero |
| `status` | `text` | Default `open`; allowed: `open`, `cancelled`, `completed` |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Default `now()` on insertion |

Allowed categories:

- Career & Professional Life
- Darden & MBA Life
- Ideas, Books & Current Events
- Culture & Global Perspectives
- Interests
- Life & Connection
- Other

Capacity means guest seats: students plus family members, excluding the host. The backend enforces the product's three-student minimum and appropriate capacity at event creation. SQL only requires positive capacity; it also permits past dates so historical data can be stored.

Host anonymity and address visibility are API-response/authorization responsibilities. Storing a host ID and address does not itself hide them from a database role allowed to read them.

### `registrations`

| Column | Type | Constraint/default and meaning |
|---|---|---|
| `id` | `uuid` | PK; default `gen_random_uuid()` |
| `dinner_id` | `uuid` | FK to `dinners.id` |
| `student_id` | `uuid` | FK to `profiles.id` |
| `status` | `text` | Default `reserved`; allowed: `reserved`, `cancelled`, `attended`, `no_show`, `excused` |
| `family_seats` | `integer` | Default `0`; cannot be negative |
| `dietary_notes` | `text` | Student's dinner-specific notes; default `''`; maximum 2,000 characters |
| `family_dietary_notes` | `text` | Family requirements; default `''`; maximum 4,000 characters |
| `created_at` | `timestamptz` | Default `now()` |
| `status_changed_at` | `timestamptz` | Default `now()` on insertion |

`UNIQUE(dinner_id, student_id)` allows only one registration row per student per dinner, including cancelled records. Rebooking should update the existing cancelled row rather than insert a duplicate.

A booking occupies `1 + family_seats` seats. The family yes/no UI answer can be derived from whether `family_seats > 0`; it is not stored again.

Dietary notes are intentional booking snapshots. The backend must copy/confirm them at booking time. The database does not copy profile preferences automatically or rewrite old bookings after a profile change.

### `dinner_updates`

| Column | Type | Constraint/default and meaning |
|---|---|---|
| `id` | `uuid` | PK; default `gen_random_uuid()` |
| `dinner_id` | `uuid` | FK to `dinners.id` |
| `kind` | `text` | `comment`, `details_changed` or `cancelled` |
| `body` | `text` | Nonblank; 1–5,000 characters |
| `created_at` | `timestamptz` | Default `now()` |

The intended author is the dinner host; the backend must verify ownership before writing a host update. Editing or cancelling a dinner does not automatically create an announcement or email jobs in this schema.

### `email_outbox`

| Column | Type | Constraint/default and meaning |
|---|---|---|
| `id` | `uuid` | PK; default `gen_random_uuid()`; can be used as a provider idempotency key |
| `update_id` | `uuid` | FK to `dinner_updates.id` |
| `recipient_id` | `uuid` | FK to `profiles.id` |
| `sent_at` | `timestamptz`, nullable | Worker records successful provider acceptance |
| `available_at` | `timestamptz` | Default `now()`; earliest next attempt |
| `lease_until` | `timestamptz`, nullable | Worker-claim expiry |
| `lease_token` | `uuid`, nullable | Token for identifying a worker's claim |
| `attempt_count` | `integer` | Default `0`; cannot be negative |
| `last_error` | `text`, nullable | Last delivery failure summary |

`UNIQUE(update_id, recipient_id)` prevents duplicate queue records for the same announcement/student. Dinner details and recipient email are joined through related records instead of maintained as separate current copies.

The table does not claim jobs, increment attempts, expire leases or send emails automatically. A backend worker must implement those operations. Queue uniqueness does not guarantee exactly-once delivery through an external provider.

## Relationships and joins

| Parent → child | Relationship | Join |
|---|---|---|
| `auth.users` → `profiles` | At most one app profile per Auth user; every profile requires an Auth user | `auth.users.id = profiles.id` |
| `profiles` → `dietary_preferences` | One to zero-or-one | `profiles.id = dietary_preferences.profile_id` |
| `profiles` → `dinners` | One to many hosted dinners | `profiles.id = dinners.host_id` |
| `profiles` → `registrations` | One to many bookings | `profiles.id = registrations.student_id` |
| `dinners` → `registrations` | One to many bookings | `dinners.id = registrations.dinner_id` |
| `dinners` → `dinner_updates` | One to many announcements | `dinners.id = dinner_updates.dinner_id` |
| `dinner_updates` → `email_outbox` | One to many recipient deliveries | `dinner_updates.id = email_outbox.update_id` |
| `profiles` → `email_outbox` | One to many messages received | `profiles.id = email_outbox.recipient_id` |

Students and dinners have a many-to-many attendance relationship through `registrations`, plus an independent host relationship. No family-member join is required to count reserved seats.

## Development dataset

After a first seed into an otherwise empty application schema:

| Table | Expected rows |
|---|---:|
| `profiles` | 20 |
| `dietary_preferences` | 19 |
| `dinners` | 18 |
| `registrations` | 45 |
| `dinner_updates` | 3 |
| `email_outbox` | 8 |

There are also 20 corresponding fixture Auth users. All people, email addresses, phone numbers and addresses are fictional. Dates are relative to seed execution, keeping upcoming examples in the future when loaded.

### Useful scenarios

| Fixture | What it lets the backend test |
|---|---|
| Maya Chen | Experienced host; the upcoming Career dinner has three students, two family seats, five reserved seats and one seat left |
| Ben Thompson | Host of a fully booked upcoming Culture dinner |
| Priya Shah | Student bringing two family members with separate dietary requirements |
| Noah Davis | Attended three dinners without hosting; intended hosting-allowance block |
| Mia Patel | Three recent no-shows; an active suspension is preloaded |
| Leo Garcia | Unverified email |
| Zoe Kim | Past hosted dinner with attendance still pending |
| Owen Wilson | Older no-shows and an expired suspension |
| Isha Mehta | Missing phone and dietary form |
| Hana Park | Two recent no-shows, below the suspension threshold |
| Sam Rivera | Completed hosting history to test additional attendance allowance |
| Alex Morgan | New active student with three initial attendance credits |

These histories and initial states are **test inputs**, not proof that automatic enforcement exists. The controllers/services must calculate and enforce the resulting behavior.

### Auth fixtures are not login accounts

The SQL inserts minimal `auth.users` rows to satisfy relationships and test database scenarios. It does not create passwords or managed email identities. You cannot assume the sample users can sign in through Supabase Auth.

The seed sets sample confirmation timestamps/statuses directly, including deliberately unverified Leo. This does not send activation emails or prove ownership of a real inbox.

If you need password-login test accounts, create them through Supabase Auth's admin API first, then seed the application records. Existing matching fixture emails must carry `user_metadata.seed_dataset = 'darden_sgd_demo_v2'`; the seed refuses to overwrite a matching non-fixture account. Auth-generated UUIDs are supported because the seed maps existing users by email.

The seed header references an optional `00_create_login_users.mjs` helper from earlier work. **That helper is not included in this PR and is not required for SQL-only setup.**

### Email jobs are paused

All unsent sample email jobs have `available_at` set 100 years in the future. One sent example and a simulated retry error support delivery-state testing without making the fictional recipients immediately eligible for sending.

Keep real email delivery disabled or mocked when testing fictional accounts. New jobs created by an application use the normal `available_at = now()` default unless the backend overrides it.

### Reseeding

The seed is not an idempotent reset: it refuses to run if dinners already exist in its reserved fixture namespace. A failed attempt should be rolled back before continuing.

It references an earlier `04_cleanup_demo_data.sql`, which is **not included in this PR**. For repeatable isolated tests, recreate a disposable test project or use a separately reviewed fixture-cleanup script. Do not drop a populated shared schema just to rerun the sample data.

The seed uses the prefix `sgd.seed.` for fixture emails and reserved `d4de0000-*` UUID namespaces for its generated application records. Do not reuse those namespaces for unrelated records. Existing tagged fixture profiles and confirmation/status values are reset to the documented starting state when setup proceeds.

## Verify the installation

Run the following in the SQL Editor as the administrator. These are ordinary inspection queries, not RPC calls.

### Check all six table counts

```sql
SELECT 'profiles' AS table_name, count(*) AS row_count FROM dinner_app.profiles
UNION ALL SELECT 'dietary_preferences', count(*) FROM dinner_app.dietary_preferences
UNION ALL SELECT 'dinners', count(*) FROM dinner_app.dinners
UNION ALL SELECT 'registrations', count(*) FROM dinner_app.registrations
UNION ALL SELECT 'dinner_updates', count(*) FROM dinner_app.dinner_updates
UNION ALL SELECT 'email_outbox', count(*) FROM dinner_app.email_outbox;
```

The expected counts above apply to a new application schema with only this seed data. Additional real/test records will change them.

### Inspect a host's registrations and dietary notes

```sql
SELECT
  d.title,
  p.full_name,
  r.status,
  r.family_seats,
  1 + r.family_seats AS party_size,
  r.dietary_notes,
  r.family_dietary_notes
FROM dinner_app.registrations r
JOIN dinner_app.dinners d ON d.id = r.dinner_id
JOIN dinner_app.profiles p ON p.id = r.student_id
WHERE d.id = 'd4de0000-2000-4000-8000-000000000001'
  AND r.status <> 'cancelled'
ORDER BY p.full_name;
```

This is Maya's Career dinner: three student rows, two extra family seats and five total seats. A production API must also verify the caller owns the dinner before returning these personal details.

### Confirm the six tables have RLS enabled

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'dinner_app'
ORDER BY tablename;
```

`rowsecurity` should be `true` for every application table.

## Access model

The schema script revokes schema/table privileges from `PUBLIC`, `anon`, `authenticated` and `service_role`, and enables Row Level Security on all six tables. It installs no client policies or backend-reader role.

Consequently:

- A successful SQL Editor query as the administrator does not imply a browser or backend login has access.
- Do not expose `dinner_app` as a browser Data API schema to work around missing backend access.
- A direct backend PostgreSQL login needs explicit schema usage, table/column privileges and applicable RLS policies, or an appropriately privileged administrative connection for controlled setup.
- A Supabase API service-role key is not a PostgreSQL connection string, and it does not restore privileges explicitly revoked by this script.
- The backend must authorize individual hosts/students before returning or changing records. A shared backend database login is not an individual user identity.

This PR does not include `host_status_reader.sql`. If using the separately supplied Node dashboard, use the reader-role setup supplied with that application or another reviewed backend-access configuration.

## Business rules to implement in the backend

These are the intended application rules; the schema alone does not execute them:

| Rule | Backend responsibility |
|---|---|
| Darden-only accounts | Enforce `@darden.virginia.edu` admission through a non-bypassable Auth flow; configure email verification separately |
| Profile onboarding | Create/reconcile the app profile and require name, phone and dietary answers before the relevant actions |
| Account status | Combine Auth verification with suspension expiry; maintain the stored status without treating it as permanently authoritative |
| Hosting allowance | Start with three attendances; each completed hosted dinner unlocks three more; outstanding reservations reserve allowance |
| No-show suspension | Third no-show within 30 days triggers a 30-day suspension; apply the agreed reset after expiry |
| Suspension effects | Block new booking and hosting while allowing existing obligations to be managed |
| Minimum participation | Require three student registrations, excluding family and host |
| Capacity | Count `1 + family_seats` per included booking and prevent overbooking transactionally |
| Host check-in | Require complete attendance results after the event before the host books/hosts again |
| Dietary snapshots | Save requirements for that booking; do not silently change them when profile preferences change |
| Announcements | Authorize the host and insert the update and recipient jobs together |
| Delivery processing | Lease jobs safely, send via a provider, handle retries and record results |
| Timestamp maintenance | Update `updated_at` and `status_changed_at` on relevant changes; `DEFAULT now()` only initializes inserted rows |

A useful allowance calculation is:

```text
remaining allowance = 3 + (3 × completed hosted dinners)
                        − attended dinners
                        − outstanding reserved bookings
```

Cancelled dinners release their booking commitments. Family seats do not consume the student's attendance allowance. Full capacity and the three-student minimum are separate facts: one student bringing five family members fills a six-seat dinner but does not meet the student minimum.

Use controller → service → repository responsibilities: the controller handles HTTP/authentication, the service applies product rules, and the repository performs queries/transactions. This PR provides the repository's database foundation, not those application layers.

## Troubleshooting

| Problem | What to check |
|---|---|
| `schema "dinner_app" already exists` | This is a fresh installer, not an update. Use the existing schema or a proper migration. |
| Seed reports demo dinners already exist | Do not rerun it as a reset. Use isolated setup or reviewed fixture cleanup. |
| Tables appear missing in Table Editor | Select schema `dinner_app`, not `public`. |
| Permission denied from the backend/browser | This PR deliberately grants no application access; configure the backend role and RLS permissions. |
| Sample account cannot log in | SQL fixtures have no password/email identity. Create login-capable test accounts through Auth. |
| New Auth user has no profile | No provisioning trigger is installed; the backend must create/reconcile the profile. |
| A suspension expired but stored status is unchanged | Status expiry is a backend responsibility, not an automatic database transition. |
| No confirmation or announcement email arrives | This PR neither configures Auth mail nor runs an email worker. |
| RPC examples from an older README fail | This schema intentionally creates no custom RPC endpoints. |

## References

- [Supabase: managing user data](https://supabase.com/docs/guides/auth/managing-user-data)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: connecting to PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)

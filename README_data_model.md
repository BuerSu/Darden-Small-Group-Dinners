# Darden Small Group Dinners — Fresh Install

This database supports verified Darden student accounts, anonymous dinner listings, student and family bookings, dietary preferences, hosting eligibility, attendance check-in, no-show suspensions, and host announcements with queued email delivery.

## Fresh-install setup

1. Create a **new Supabase project** that does not already contain the dinner application schema.
2. Open the SQL Editor, paste the complete contents of `00_fresh_install.sql`, and run it once as `postgres`. The script creates the six application tables, indexes, triggers, private helpers, public RPC functions, and access restrictions in one transaction.
3. In the Table Editor, choose schema **`dinner_app`** to inspect the application tables. Supabase Auth accounts remain under Authentication / `auth.users`.
4. Complete the Auth and email configuration described below.
5. Connect the frontend through the public RPC functions; do not expose the private schema or query its tables directly from the browser.

This fresh-install script is **not rerunnable** and must not be run on top of the original schema or an already upgraded project.

## Model overview

| Table | What one row represents |
|---|---|
| `profiles` | A student's app profile and current account state |
| `dietary_preferences` | A student's answered dietary-preference form |
| `dinners` | One hosted dinner |
| `registrations` | One student's booking, accompanying family count, and attendance outcome |
| `dinner_updates` | One host announcement or event-change/cancellation notice |
| `email_outbox` | One update to be delivered to one student |

The same student can host and attend. Family members need no individual account. Supabase's built-in `auth.users` table handles credentials, canonical email, and email confirmation; it is not an extra application table created by this script.

## Tables and columns

All application tables live in private schema `dinner_app`. `PK` means primary key; `FK` means foreign key. All IDs are UUIDs. Times are `timestamptz`. Fields are required unless marked optional.

### profiles

| Column | Type | Purpose |
|---|---|---|
| id | uuid PK, FK auth.users.id | Same ID as authentication account |
| full_name | text | Up to 150 characters; required for onboarding |
| phone_number | text, optional during onboarding | International form, e.g. +14345550123; required before booking/hosting |
| graduation_year | smallint, optional | 2000–2200 |
| section | text, optional | Up to 30 characters |
| account_status | text | active, suspended, not_verified; UI labels Active, Suspended, Not Verified |
| suspended_until | timestamptz, optional | Latest suspension expiry and next no-show cycle boundary |
| created_at | timestamptz | Account/profile creation time |

Email and email verification remain authoritative in Supabase `auth.users`. `my_account()` joins them into the profile response without storing another independently editable email or verified flag. `account_status` is a physical column required by the caselet. Auth updates and penalty updates synchronize it; `my_account()` and eligibility checks refresh expired suspensions. A periodic backend sweep can also refresh all statuses. If suspension expires but the email is still unverified, status becomes `not_verified`, so verification cannot be bypassed.

Signup metadata seeds name, phone and dietary preferences. Later profile/diet edits use dedicated RPCs; changing Auth metadata later does not overwrite these canonical application records. A stub account can exist before completing onboarding, but cannot book or host until name, phone and dietary form are complete. Phone is a contact field, not a separate phone-login identity.

### dietary_preferences

| Column | Type | Purpose |
|---|---|---|
| profile_id | uuid PK, FK profiles.id | Zero or one answered dietary form per student |
| is_vegan | boolean | Default false |
| is_vegetarian | boolean | Default false |
| is_pescatarian | boolean | Default false |
| has_nut_allergy | boolean | Default false |
| has_dairy_allergy | boolean | Default false |
| has_gluten_restriction | boolean | Default false |
| other_notes | text | Max 2,000 characters; default empty |
| updated_at | timestamptz | Last form save |

Missing row means unanswered. An all-false row means explicitly none of the listed needs. Flags are independent; detailed preparation/cross-contact instructions belong in notes. Saving this form replaces all fields, rather than patching only supplied flags. Dietary choices never block a student from joining a particular dinner.

### dinners

| Column | Type | Purpose |
|---|---|---|
| id | uuid PK | Dinner identifier |
| host_id | uuid FK profiles.id | Exactly one owning host; hidden from browse/guest responses |
| title | text | Topic title, 1–200 characters |
| topic_category | text | One of seven fixed categories below |
| description | text | Topic description, up to 5,000 characters |
| address | text | Exact event location, 1–1,000 characters |
| arrival_instructions | text | Up to 2,000 characters; host/registered-participant access |
| starts_at | timestamptz | Start; future at creation |
| ends_at | timestamptz | End; after start |
| signup_deadline | timestamptz | Future at creation; no later than start |
| guest_capacity | integer | At least 3; available seats excluding host, including family |
| status | text | open, cancelled, completed |
| created_at | timestamptz | Creation time |
| updated_at | timestamptz | Latest edit/cancellation/completion |

Categories: Career & Professional Life; Darden & MBA Life; Ideas, Books & Current Events; Culture & Global Perspectives; Interests; Life & Connection; Other.

Date and time are formatted from `starts_at`, rather than stored twice. Seats remaining and student-signup count are calculated. Minimum participation is interpreted as **three student registrations**, excluding host/family, retaining the original caselet's sign-up basis. `participation_met` is derived, not a stored confirmed flag. Capacity excludes the host. If you intend family members to satisfy the minimum, that is a separate policy change.

A trusted periodic task cancels underfilled dinners after signup deadline, including those missed by a late task run. Hosts cannot check in an underfilled dinner to earn credits. Only host check-in completes a dinner in this API.

### registrations

| Column | Type | Purpose |
|---|---|---|
| id | uuid PK | Registration identifier |
| dinner_id | uuid FK dinners.id | Dinner booked |
| student_id | uuid FK profiles.id | Student booking |
| status | text | reserved, cancelled, attended, no_show, excused |
| family_seats | integer | Zero or more extra seats; no redundant bringing_family field |
| dietary_notes | text | Student's confirmed requirements for this dinner; max 2,000 characters |
| family_dietary_notes | text | Combined family requirements; max 4,000 characters |
| created_at | timestamptz | Original booking time |
| status_changed_at | timestamptz | Last booking/attendance transition |

Unique `(dinner_id, student_id)` prevents duplicates. Cancellation then rebooking reuses the row. One lifecycle status avoids conflicting booking and attendance columns. The host check-in UI accepts present/absent, mapping to `attended`/`no_show`. `excused` is reserved for deliberate administrator handling; hosts cannot use it to erase no-shows.

The family form is: bringing anyone? No means zero; Yes means require a positive integer. Party size is `1 + family_seats`. Family members have no individual account or attendance outcome. Combined family dietary notes preserve food requirements without an unnecessary person table.

Booking-specific dietary notes are intentional snapshots. NULL student notes copies current profile preferences; explicit empty string means no notes for this booking. Profile edits later cannot silently change an existing dinner's food requirements.

### dinner_updates

| Column | Type | Purpose |
|---|---|---|
| id | uuid PK | Update identifier |
| dinner_id | uuid FK dinners.id | Associated dinner |
| kind | text | comment, details_changed, cancelled |
| body | text | Message, 1–5,000 characters |
| created_at | timestamptz | Posted time |

Only the host posts comments; author identity is inferred from the dinner, not duplicated. Editing details and cancelling emit notices automatically. Messages are visible only to the host and noncancelled registrants. Only students have recipient email addresses; each student receives one email for their family party. This is an announcement feed, not a guest-to-guest discussion system.

### email_outbox

| Column | Type | Purpose |
|---|---|---|
| id | uuid PK | Delivery job and provider idempotency key |
| update_id | uuid FK dinner_updates.id | The message to send |
| recipient_id | uuid FK profiles.id | Intended student recipient |
| sent_at | timestamptz, optional | Successful provider acceptance |
| available_at | timestamptz | Earliest next attempt |
| lease_until | timestamptz, optional | Worker reservation expires after five minutes |
| lease_token | uuid, optional | Rejects stale workers acknowledging a newer claim |
| attempt_count | integer | Attempts, default zero |
| last_error | text, optional | Most recent failure summary |

Unique `(update_id, recipient_id)` prevents duplicate queue rows. Recipient email and dinner/message data are joined rather than independently maintained copies. The recipient set is snapshotted when the update is posted. Message and job insertion happen in the same database transaction, so a failed update cannot partially queue emails. Successful jobs remain for delivery tracking; there is no extra status enum duplicating sent_at/lease state.

Email delivery requires a worker/provider. SQL queues work; it cannot itself guarantee external email delivery. `04_email_worker.mjs` is an optional server-side Resend example, not deployed or executed against your accounts. Delivery is at least once; provider idempotency reduces duplicate attempts within the provider's retention period. The worker uses current recipient/event details at send time; a details change between retries can change the payload. Adapt delivery snapshots/provider policy if strict replay of an identical email is required. An email is marked sent when accepted by the provider, not when read or delivered to the inbox.

## Joins

| Parent | Child | Cardinality | Join |
|---|---|---|---|
| auth.users | profiles | 1:1 for app accounts | auth.users.id = profiles.id |
| profiles | dietary_preferences | 1:0/1 | profiles.id = dietary_preferences.profile_id |
| profiles | dinners | 1:many hosted | profiles.id = dinners.host_id |
| profiles | registrations | 1:many booked | profiles.id = registrations.student_id |
| dinners | registrations | 1:many | dinners.id = registrations.dinner_id |
| dinners | dinner_updates | 1:many | dinners.id = dinner_updates.dinner_id |
| dinner_updates | email_outbox | 1:many recipient deliveries | dinner_updates.id = email_outbox.update_id |
| profiles | email_outbox | 1:many messages received | profiles.id = email_outbox.recipient_id |

No family join is needed to count seats. Profiles and dinners are many-to-many through registrations for attendance, plus the independent host relationship.

## Eligibility and attendance behavior

```
remaining allowance = 3 + 3 × completed hosted dinners
                        − attended dinners
                        − outstanding reserved bookings
```

Family seats and no-shows do not count as attended dinners. Reservations reserve allowance until cancelled or finalized, including after dinner end. Cancelled dinners release commitments without redundant updates to all registration rows.

A new dinner booking requires all of: verified allowed email, completed onboarding, no active suspension, no pending check-in for a past hosted dinner, and positive allowance. Creating a dinner requires the same checks except attendance allowance: hosting is how the student earns it back. Insufficient hosting allowance leaves `account_status=active`.

After an event's end, its host must submit exactly one present/absent result for **every** noncancelled student registration. Partial or duplicate entries fail the whole transaction. Check-in finalizes attendance and dinner completion together, awards one hosted-dinner credit, and assesses any third-no-show penalties. The host can submit the identical result again safely; changed final results require deliberate administrative correction. Suspended hosts can still fulfill check-in obligations and manage existing plans, but cannot create or book new dinners.

A third no-show triggers suspension only if its **dinner end date falls within the past 30 days**. Attendance assessment time does not make a 31-day-old dinner count as recent. During a running suspension additional assessments do not extend the penalty. On expiry the cycle resets using retained `suspended_until` as a lower date boundary, and the rolling window still applies. Old attendance is never deleted. The period described as "a month" is implemented as 30 days, consistent with the document's Suspend Until workflow and earlier agreed duration.

Cancellation is allowed before start; existing reservations are not automatically cancelled when a student is suspended. A host's uncompleted check-in blocks new bookings/hosting, not access to existing plans or the ability to fulfill that check-in. These operational details retain the earlier MVP assumptions where the updated document is silent.

## Installation and Auth configuration

After running the appropriate SQL script:

1. In Supabase Auth, enable **Confirm email** for email/password signup. This setting is essential: SQL trusts Auth's confirmed-email timestamp and cannot prove mailbox ownership if Auth automatically confirms everyone.
2. Configure the Site URL and allowed confirmation redirect URLs for your app. Configure the confirmation template/SMTP sender so students can receive activation links.
3. Keep `dinner_app` out of Data API exposed schemas. The public RPC functions are the client interface; there are no direct table grants or client RLS policies. All six tables have RLS enabled as defense in depth. No service-role key belongs in the browser.
4. Use the signup metadata example in `03_frontend_examples.js` to collect name, phone and dietary form. Missing onboarding data can be completed after activation, before the user can book or host.
5. Periodically call `admin_cancel_underfilled_dinners()` and optionally `admin_refresh_account_statuses()` from a trusted backend. Expiry is also checked on account/eligibility access, so a delayed sweep cannot extend a booking suspension.
6. Configure/run an email worker to claim and acknowledge queued notices. This is separate from Supabase Auth activation email delivery. The optional worker uses Node 20+, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY and EMAIL_FROM (a provider-verified sender). It performs one bounded batch per invocation; schedule it server-side. Nothing sends merely by downloading these files.

The SQL enforces the domain through a trigger on new Auth users and actual email changes, so alternate signup clients cannot bypass frontend validation. Preexisting non-Darden Auth accounts, if any, are retained during installation but marked not_verified and blocked from activities. Signup failures from a database trigger can surface as generic Auth errors; frontend validation provides the clearer domain/phone message.

The application is still anonymous at the **host identity** level: browse responses omit host_id/name/email. Exact addresses are visible to verified students per the updated document, which may naturally reveal a residential host. Arrival instructions remain restricted to registrants and host.

## Public RPC reference

Use `supabase.rpc(functionName, arguments)` from your initialized client. Student calls require the signed-in user's JWT. The SQL Editor does not normally have a student JWT, so `auth.uid()` is null there and student-only examples will fail until called in an authenticated context.

| Function | Purpose | Access |
|---|---|---|
| `my_account()` | Profile, email, refreshed status, allowance and eligibility flags | Own account |
| `save_my_profile(...)` | Name, phone, graduation year and section | Own account |
| `my_dietary_preferences()` | Read dietary form | Own account |
| `save_my_dietary_preferences(...)` | Replace dietary form | Own account |
| `browse_dinners(...)` | Category/date/search filters, paging, counts and public event details | Verified student |
| `create_dinner(...)` | Create a dinner | Eligible host |
| `update_dinner(...)` | Edit a future dinner and queue update notices | Owning host |
| `cancel_dinner(...)` | Cancel a future dinner and queue notices | Owning host |
| `my_hosted_dinners()` | Hosted history, signup counts and check-in needs | Own account |
| `book_dinner(...)` | Atomically reserve student and family seats | Eligible student |
| `cancel_registration(...)` | Cancel before dinner start | Own booking |
| `my_registrations()` | Booking history and event status | Own account |
| `dinner_location(...)` | Address; arrival instructions when authorized | Verified student, with additional participant checks |
| `host_roster(...)` | Student/family seat counts and dietary notes | Owning host |
| `host_submit_checkin(...)` | Finalize all participants' attendance after event end | Owning host |
| `post_dinner_update(...)` | Post an announcement and queue participant emails | Owning host |
| `dinner_updates(...)` | Read event announcements | Host/noncancelled registrant |
| `admin_cancel_underfilled_dinners()` | Close underfilled dinners after signup deadline | Trusted backend |
| `admin_refresh_account_statuses()` | Refresh stored statuses for expired suspensions | Trusted backend |
| `admin_claim_emails(...)` | Lease pending delivery jobs | Trusted backend |
| `admin_ack_email(...)` | Record delivery acceptance/failure | Trusted backend |

A student's eligibility flags are advisory for the UI. Booking and hosting RPCs independently recheck the rules in the database. Event edits, cancellations and check-in remain available for existing obligations even when the host cannot create a new dinner.

### Frontend examples

```javascript
// Own profile and eligibility.
const { data: account, error: accountError } = await supabase.rpc('my_account');
if (accountError) throw accountError;

// Available dinner listings; dates are timezone-aware ISO strings when supplied.
const { data: dinners, error: browseError } = await supabase.rpc('browse_dinners', {
  p_category: 'Darden & MBA Life',
  p_from: new Date().toISOString(),
  p_until: null,
  p_search: null,
  p_limit: 50,
  p_offset: 0
});
if (browseError) throw browseError;

// One student and two family seats. Null notes snapshots profile defaults.
const { data: registrationId, error: bookingError } = await supabase.rpc('book_dinner', {
  p_dinner_id: dinnerId,
  p_family_seats: 2,
  p_dietary_notes: null,
  p_family_dietary_notes: 'Partner is pescatarian; child has a nut allergy.'
});
if (bookingError) throw bookingError;

// After the dinner ends, include every noncancelled roster registration once.
const { error: checkinError } = await supabase.rpc('host_submit_checkin', {
  p_dinner_id: dinnerId,
  p_attendance: roster.map(person => ({
    registration_id: person.registration_id,
    present: attendanceByRegistration[person.registration_id]
  }))
});
if (checkinError) throw checkinError;
```

For signup, use `supabase.auth.signUp` with the Darden email, password, confirmation redirect and metadata:

```javascript
const { data, error } = await supabase.auth.signUp({
  email: 'student@darden.virginia.edu',
  password: passwordFromForm,
  options: {
    emailRedirectTo: confirmationRedirect,
    data: {
      full_name: 'Student Name',
      phone_number: '+14345550123',
      dietary_preferences: {
        is_vegan: false,
        is_vegetarian: false,
        is_pescatarian: false,
        has_nut_allergy: true,
        has_dairy_allergy: false,
        has_gluten_restriction: false,
        other_notes: 'Please avoid cross-contact with nuts.'
      }
    }
  }
});
if (error) throw error;
```

The frontend must collect an explicit dietary answer, including an all-false form when none apply. New signup metadata seeds the app records; subsequent changes use the profile/dietary RPCs.

## Integrity, access and design choices

- Primary and foreign keys enforce the relationships; unique `(dinner_id, student_id)` prevents duplicate bookings.
- Booking checks and family seats are saved in one transaction, with dinner/student row locks to serialize capacity and allowance changes.
- Check-in requires all noncancelled registrations, rejects duplicate or foreign registration IDs, and finalizes the dinner and attendance together.
- All six tables have Row Level Security enabled and no direct client grants. Public functions authorize callers; private helpers use fully qualified names and an empty search path.
- Email and verification are read from Auth. Seat counts, participation flags, hosting allowance, no-show counts and family yes/no are derived rather than separately stored.
- The physical account-status column is synchronized with Auth/penalty updates and refreshed when read or checked. Dietary booking snapshots deliberately retain the requirements communicated for that dinner.
- Phone numbers and dietary forms are not exposed by the browse response. The host sees only the relevant roster information.
- Account deletion/anonymization requires an administrative process because historical profiles are referenced by bookings and hosted dinners.
- UVA colors, fonts and other UI styling belong in frontend code, not database tables.

## Validation and scope

The fresh-install path passed **80 local embedded-PostgreSQL checks**. The full supplied test suite also checks the separate upgrade path and verifies that both produce matching column schemas. Four mocked email-worker checks passed; no real emails were sent.

Tests used a minimal mock of Supabase Auth. Real hosted Auth/activation links, SMTP, concurrent load, email-provider integration and your frontend still require integration testing. The SQL creates the database layer; it does not deploy a frontend, scheduler or email service, and it has not been applied to your project by this README.

## References

- https://supabase.com/docs/guides/auth/general-configuration
- https://supabase.com/docs/reference/javascript/auth-signup
- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/database/functions

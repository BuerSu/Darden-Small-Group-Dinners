-- NEW PROJECT ONLY. Data schema for JavaScript/Python-controlled workflows.
-- Supabase provides auth.users. This script contains no application functions,
-- triggers or RPCs. It does not remove anything from an existing database.
-- All product rules, authorization decisions and multi-row workflows belong
-- to backend services/repositories using transactions where required.
BEGIN;
CREATE SCHEMA dinner_app;
CREATE TABLE dinner_app.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 full_name text NOT NULL DEFAULT '' CHECK(length(full_name)<=150),
 phone_number text CHECK(phone_number ~ '^\+[1-9][0-9]{7,14}$'),
 graduation_year smallint CHECK(graduation_year BETWEEN 2000 AND 2200),
 section text CHECK(length(section)<=30),
 account_status text NOT NULL DEFAULT 'not_verified'
   CHECK(account_status IN ('active','suspended','not_verified')),
 suspended_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dinner_app.dietary_preferences (
 profile_id uuid PRIMARY KEY REFERENCES dinner_app.profiles(id) ON DELETE CASCADE,
 is_vegan boolean NOT NULL DEFAULT false,
 is_vegetarian boolean NOT NULL DEFAULT false,
 is_pescatarian boolean NOT NULL DEFAULT false,
 has_nut_allergy boolean NOT NULL DEFAULT false,
 has_dairy_allergy boolean NOT NULL DEFAULT false,
 has_gluten_restriction boolean NOT NULL DEFAULT false,
 other_notes text NOT NULL DEFAULT '' CHECK(length(other_notes)<=2000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dinner_app.dinners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 host_id uuid NOT NULL REFERENCES dinner_app.profiles(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 topic_category text NOT NULL DEFAULT 'Other' CHECK(topic_category IN
 ('Career & Professional Life','Darden & MBA Life','Ideas, Books & Current Events',
  'Culture & Global Perspectives','Interests','Life & Connection','Other')),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=5000),
 address text NOT NULL CHECK(length(btrim(address)) BETWEEN 1 AND 1000),
 arrival_instructions text NOT NULL DEFAULT '' CHECK(length(arrival_instructions)<=2000),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 signup_deadline timestamptz NOT NULL,
 guest_capacity integer NOT NULL CHECK(guest_capacity>0),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','cancelled','completed')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at), CHECK(signup_deadline<=starts_at)
);
CREATE TABLE dinner_app.registrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dinner_id uuid NOT NULL REFERENCES dinner_app.dinners(id),
 student_id uuid NOT NULL REFERENCES dinner_app.profiles(id),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','cancelled','attended','no_show','excused')),
 family_seats integer NOT NULL DEFAULT 0 CHECK(family_seats>=0),
 dietary_notes text NOT NULL DEFAULT '' CHECK(length(dietary_notes)<=2000),
 family_dietary_notes text NOT NULL DEFAULT '' CHECK(length(family_dietary_notes)<=4000),
 created_at timestamptz NOT NULL DEFAULT now(),status_changed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(dinner_id,student_id)
);
CREATE INDEX dinners_host_idx ON dinner_app.dinners(host_id);
CREATE INDEX dinners_browse_idx ON dinner_app.dinners(starts_at) WHERE status='open';
CREATE INDEX registrations_student_idx ON dinner_app.registrations(student_id,status);

-- Host-authored updates also represent automatic event-change/cancellation notices.
CREATE TABLE dinner_app.dinner_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dinner_id uuid NOT NULL REFERENCES dinner_app.dinners(id),
 kind text NOT NULL CHECK(kind IN('comment','details_changed','cancelled')),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 5000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dinner_updates_dinner_idx ON dinner_app.dinner_updates(dinner_id,created_at);
-- A delivery job is not a copy of the update: each row tracks one recipient.
-- Email/dinner/message are joined at send time instead of stored again.
CREATE TABLE dinner_app.email_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 update_id uuid NOT NULL REFERENCES dinner_app.dinner_updates(id),
 recipient_id uuid NOT NULL REFERENCES dinner_app.profiles(id),
 sent_at timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 lease_token uuid,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 last_error text,
 UNIQUE(update_id,recipient_id)
);
CREATE INDEX email_outbox_pending_idx ON dinner_app.email_outbox(available_at) WHERE sent_at IS NULL;

-- The browser does not access these tables directly. Backend permissions are
-- configured separately in host_status_reader.sql (read-only for this story).
REVOKE ALL ON SCHEMA dinner_app FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA dinner_app FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE dinner_app.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dinner_app.dietary_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE dinner_app.dinners ENABLE ROW LEVEL SECURITY;
ALTER TABLE dinner_app.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dinner_app.dinner_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE dinner_app.email_outbox ENABLE ROW LEVEL SECURITY;
COMMIT;

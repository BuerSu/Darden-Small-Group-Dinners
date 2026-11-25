-- OPTIONAL access setup for an existing v2 Supabase project. Run as postgres.
-- No business logic or SQL functions: only role grants and access policies.
-- Create a dedicated read-only database login in Supabase first, then grant it
-- membership of dinner_dashboard_reader. Keep its password in DATABASE_URL.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dinner_dashboard_reader') THEN
   CREATE ROLE dinner_dashboard_reader NOLOGIN;
 END IF;
END $$;
GRANT USAGE ON SCHEMA dinner_app TO dinner_dashboard_reader;
GRANT SELECT(id,full_name) ON dinner_app.profiles TO dinner_dashboard_reader;
GRANT SELECT(id,host_id,title,topic_category,description,address,starts_at,ends_at,
 signup_deadline,guest_capacity,status) ON dinner_app.dinners TO dinner_dashboard_reader;
GRANT SELECT(id,dinner_id,student_id,status,family_seats,dietary_notes,family_dietary_notes,created_at)
 ON dinner_app.registrations TO dinner_dashboard_reader;
DROP POLICY IF EXISTS host_status_reader ON dinner_app.profiles;
CREATE POLICY host_status_reader ON dinner_app.profiles FOR SELECT TO dinner_dashboard_reader USING(true);
DROP POLICY IF EXISTS host_status_reader ON dinner_app.dinners;
CREATE POLICY host_status_reader ON dinner_app.dinners FOR SELECT TO dinner_dashboard_reader USING(true);
DROP POLICY IF EXISTS host_status_reader ON dinner_app.registrations;
CREATE POLICY host_status_reader ON dinner_app.registrations FOR SELECT TO dinner_dashboard_reader USING(true);
-- Replace the name below with your dedicated database login and run separately:
-- GRANT dinner_dashboard_reader TO your_backend_login;
-- This backend role can read these rows; Node authorizes the host on every request.
-- Never give this login or its DATABASE_URL to a browser or anon/authenticated role.
COMMIT;

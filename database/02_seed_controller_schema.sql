-- DEVELOPMENT/TEST DATA ONLY. Compatible with 00_schema_controller.sql.
-- Explicitly creates profiles and fixture statuses; no triggers/functions required.
-- Run in Supabase SQL Editor as postgres. This does not alter the app schema.
-- For real login accounts, run 00_create_login_users.mjs FIRST; otherwise this
-- creates SQL-only Auth fixtures with no password/identity (not login-capable).
-- All people/addresses are fictional. Outbox jobs are paused to prevent sending.
-- Seed once. To reset, run the earlier 04_cleanup_demo_data.sql, then this file again.
BEGIN;
DO $$ BEGIN
 IF to_regclass('dinner_app.email_outbox') IS NULL OR NOT EXISTS(
 SELECT 1 FROM information_schema.columns WHERE table_schema='dinner_app'
 AND table_name='registrations' AND column_name='family_seats') THEN
 RAISE EXCEPTION 'Install the v2 application schema before this seed'; END IF;
 IF EXISTS(SELECT 1 FROM dinner_app.dinners WHERE id::text LIKE 'd4de0000-2000-4000-8000-%') THEN
 RAISE EXCEPTION 'Demo dinners already exist. Run the earlier 04_cleanup_demo_data.sql before reseeding.'; END IF;
END $$;
CREATE TEMP TABLE seed_people(n integer PRIMARY KEY,full_name text,slug text,scenario text,
 verified boolean,diet text,id uuid,email text) ON COMMIT DROP;
INSERT INTO seed_people(n,full_name,slug,scenario,verified,diet) VALUES
(1,'Maya Chen','maya.host','Experienced host',true,'none'),
(2,'Arjun Rao','arjun.student','Committed allowance; released by deadline cancellation',true,'vegetarian'),
(3,'Priya Shah','priya.family','Student bringing two family members',true,'vegetarian'),
(4,'Lucas Martin','lucas.student','Registered at full dinner',true,'none'),
(5,'Sara Ahmed','sara.vegan','Vegan guest',true,'vegan'),
(6,'Ethan Brooks','ethan.allergy','Guest with nut allergy',true,'nut'),
(7,'Ava Williams','ava.pescatarian','Pescatarian guest',true,'pescatarian'),
(8,'Noah Davis','noah.quota','Attended three; must host before another booking',true,'none'),
(9,'Mia Patel','mia.suspended','Three recent no-shows; suspended',true,'dairy'),
(10,'Leo Garcia','leo.unverified','Email not verified',false,'none'),
(11,'Zoe Kim','zoe.checkin','Host with past dinner awaiting check-in',true,'none'),
(12,'Owen Wilson','owen.restored','Expired suspension; reset no-show count',true,'gluten'),
(13,'Isha Mehta','isha.onboarding','Missing phone and dietary form',true,'missing'),
(14,'Ben Thompson','ben.host','Another eligible host',true,'none'),
(15,'Hana Park','hana.twostrikes','Two recent no-shows; not suspended',true,'none'),
(16,'Sam Rivera','sam.hosted','Hosted once; extra allowance unlocked',true,'none'),
(17,'Tara Singh','tara.student','Guest in several dinners',true,'none'),
(18,'Dev Kapoor','dev.student','Awaiting attendance at Zoe dinner',true,'none'),
(19,'Nina Lopez','nina.student','Awaiting attendance at Zoe dinner',true,'none'),
(20,'Alex Morgan','alex.new','New active student; three credits',true,'none');
UPDATE seed_people SET email='sgd.seed.'||slug||'@darden.virginia.edu';
-- Refuse to overwrite a preexisting account unless it is explicitly our fixture.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM seed_people s JOIN auth.users u ON lower(u.email)=s.email
 WHERE coalesce(u.raw_user_meta_data->>'seed_dataset','')<>'darden_sgd_demo_v2') THEN
 RAISE EXCEPTION 'A demo email belongs to a non-demo account; no data was changed'; END IF;
 IF EXISTS(SELECT 1 FROM seed_people s JOIN auth.users u
 ON u.id=('d4de0000-1000-4000-8000-'||lpad(s.n::text,12,'0'))::uuid
 WHERE lower(u.email)<>s.email) THEN
 RAISE EXCEPTION 'Reserved demo UUID collides with another account; no data was changed'; END IF;
END $$;
-- Minimal SQL fixtures are intentionally not made into password-login accounts.
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT ('d4de0000-1000-4000-8000-'||lpad(s.n::text,12,'0'))::uuid,s.email,
 CASE WHEN s.verified THEN now()-interval '60 days' ELSE NULL END,
 jsonb_build_object('full_name',s.full_name,'seed_dataset','darden_sgd_demo_v2')
FROM seed_people s WHERE NOT EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=s.email);
UPDATE seed_people s SET id=u.id FROM auth.users u WHERE lower(u.email)=s.email;
-- Explicit setup replaces the old automatic Auth->profile trigger dependency.
INSERT INTO dinner_app.profiles(id) SELECT id FROM seed_people ON CONFLICT(id) DO NOTHING;

-- Bring only tagged fixture accounts back to the documented starting scenario.
UPDATE auth.users u SET email_confirmed_at=CASE WHEN s.verified THEN now()-interval '60 days' ELSE NULL END
FROM seed_people s WHERE u.id=s.id;
UPDATE dinner_app.profiles p SET full_name=s.full_name,
 phone_number=CASE WHEN s.n=13 THEN NULL ELSE '+1202555'||lpad((100+s.n)::text,4,'0') END,
 graduation_year=CASE WHEN s.n%2=0 THEN 2027 ELSE 2028 END,
 section=CASE WHEN s.n%2=0 THEN 'A' ELSE 'B' END,suspended_until=NULL
FROM seed_people s WHERE p.id=s.id;
DELETE FROM dinner_app.dietary_preferences WHERE profile_id IN(SELECT id FROM seed_people);
INSERT INTO dinner_app.dietary_preferences(profile_id,is_vegan,is_vegetarian,is_pescatarian,
 has_nut_allergy,has_dairy_allergy,has_gluten_restriction,other_notes)
SELECT id,diet='vegan',diet='vegetarian',diet='pescatarian',diet='nut',diet='dairy',diet='gluten',
 CASE WHEN diet='nut' THEN 'Please avoid cross-contact with nuts.' ELSE '' END
FROM seed_people WHERE diet<>'missing';
CREATE TEMP TABLE seed_clock(t timestamptz) ON COMMIT DROP;
INSERT INTO seed_clock VALUES(date_trunc('minute',now()));
CREATE TEMP TABLE seed_dinners(n integer PRIMARY KEY,host_n integer,title text,category text,
 day_offset numeric,capacity integer,status text,deadline_offset numeric,id uuid) ON COMMIT DROP;
INSERT INTO seed_dinners(n,host_n,title,category,day_offset,capacity,status,deadline_offset) VALUES
(1,1,'Career switches over supper','Career & Professional Life',3,6,'open',2),
(2,14,'Food and culture exchange','Culture & Global Perspectives',5,4,'open',4),
(3,1,'Books that changed our minds','Ideas, Books & Current Events',7,6,'open',6),
(4,14,'Hobbies beyond the case method','Interests',9,6,'open',8),
(5,1,'A cancelled community supper','Life & Connection',4,6,'cancelled',3),
(6,14,'Deadline passed: needs three students','Other',1,6,'open',-0.05),
(7,1,'Making the most of Darden','Darden & MBA Life',11,5,'open',10),
(101,1,'Past career conversation I','Career & Professional Life',-22,6,'completed',-23),
(102,1,'Past career conversation II','Career & Professional Life',-18,6,'completed',-19),
(103,1,'Past career conversation III','Career & Professional Life',-15,6,'completed',-16),
(104,16,'Sam hosted a dinner','Life & Connection',-12,6,'completed',-13),
(201,1,'Recent dinner: first absence','Darden & MBA Life',-10,6,'completed',-11),
(202,1,'Recent dinner: second absence','Darden & MBA Life',-7,6,'completed',-8),
(203,1,'Recent dinner: third absence','Darden & MBA Life',-2,6,'completed',-3),
(301,1,'Older dinner: first absence','Other',-50,6,'completed',-51),
(302,1,'Older dinner: second absence','Other',-45,6,'completed',-46),
(303,14,'Older dinner: third absence','Other',-40,6,'completed',-41),
(401,11,'Zoe dinner awaiting check-in','Life & Connection',-1,6,'open',-2);
UPDATE seed_dinners SET id=('d4de0000-2000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
INSERT INTO dinner_app.dinners(id,host_id,title,topic_category,description,address,arrival_instructions,
 starts_at,ends_at,signup_deadline,guest_capacity,status,created_at,updated_at)
SELECT d.id,p.id,d.title,d.category,'Fictional seeded dinner for application testing: '||d.title||'.',
 'TEST LOCATION ONLY - Demo apartment '||d.n||', Charlottesville, VA',
 'Test instructions: do not travel to this fictional address.',
 c.t+make_interval(secs=>(d.day_offset*86400)::double precision),
 c.t+make_interval(secs=>(d.day_offset*86400)::double precision)+interval '2 hours',
 c.t+make_interval(secs=>(d.deadline_offset*86400)::double precision),d.capacity,d.status,
 c.t+make_interval(secs=>(least(d.deadline_offset-3,-60)*86400)::double precision),c.t
FROM seed_dinners d JOIN seed_people p ON p.n=d.host_n CROSS JOIN seed_clock c;
CREATE TEMP TABLE seed_regs(dinner_n integer,person_n integer,status text,family_seats integer,
 dietary_notes text,family_dietary_notes text) ON COMMIT DROP;
INSERT INTO seed_regs VALUES
(101,8,'attended',0,'',''),
(101,16,'attended',0,'',''),
(101,14,'attended',0,'',''),
(102,8,'attended',0,'',''),
(102,16,'attended',0,'',''),
(102,3,'attended',0,'',''),
(103,8,'attended',0,'',''),
(103,16,'attended',0,'',''),
(103,5,'attended',0,'',''),
(104,14,'attended',0,'',''),
(104,1,'attended',0,'',''),
(104,6,'attended',0,'',''),
(201,9,'no_show',0,'',''),
(201,15,'no_show',0,'',''),
(201,7,'attended',0,'',''),
(202,9,'no_show',0,'',''),
(202,15,'no_show',0,'',''),
(202,4,'attended',0,'',''),
(203,9,'no_show',0,'',''),
(203,2,'attended',0,'',''),
(203,17,'attended',0,'',''),
(301,12,'no_show',0,'',''),
(301,3,'attended',0,'',''),
(301,6,'attended',0,'',''),
(302,12,'no_show',0,'',''),
(302,5,'attended',0,'',''),
(302,7,'attended',0,'',''),
(303,12,'no_show',0,'',''),
(303,4,'attended',0,'',''),
(303,17,'attended',0,'',''),
(401,2,'reserved',0,'',''),
(401,18,'reserved',0,'',''),
(401,19,'reserved',0,'',''),
(1,5,'reserved',0,'Vegan',''),
(1,6,'reserved',0,'Nut allergy: avoid cross-contact',''),
(1,3,'reserved',2,'Vegetarian','Partner is pescatarian; child has a nut allergy.'),
(2,4,'reserved',1,'','One family member; no dietary restrictions.'),
(2,7,'reserved',0,'Pescatarian',''),
(2,17,'reserved',0,'',''),
(4,16,'reserved',1,'','Partner is vegetarian.'),
(4,15,'reserved',0,'',''),
(5,2,'reserved',0,'Vegetarian',''),
(5,16,'reserved',0,'',''),
(6,2,'reserved',0,'Vegetarian',''),
(6,15,'reserved',0,'','');
INSERT INTO dinner_app.registrations(id,dinner_id,student_id,status,family_seats,dietary_notes,
 family_dietary_notes,created_at,status_changed_at)
SELECT ('d4de0000-3000-4000-8000-'||lpad((r.dinner_n*100+r.person_n)::text,12,'0'))::uuid,
 d.id,p.id,r.status,r.family_seats,r.dietary_notes,r.family_dietary_notes,
 least(c.t-interval '3 days',event.starts_at-interval '4 days'),
 CASE WHEN r.status IN('attended','no_show') THEN event.ends_at+interval '1 hour' ELSE c.t-interval '3 hours' END
FROM seed_regs r JOIN seed_dinners d ON d.n=r.dinner_n JOIN seed_people p ON p.n=r.person_n
JOIN dinner_app.dinners event ON event.id=d.id CROSS JOIN seed_clock c;
-- Fixture penalty dates follow the documented three-no-show histories.
-- This seed explicitly sets fixture statuses below; runtime status updates are backend-owned.
UPDATE dinner_app.profiles SET suspended_until=(SELECT ends_at+interval '30 days'
 FROM dinner_app.dinners WHERE id='d4de0000-2000-4000-8000-000000000203')
WHERE id=(SELECT id FROM seed_people WHERE n=9);
UPDATE dinner_app.profiles SET suspended_until=(SELECT ends_at+interval '30 days'
 FROM dinner_app.dinners WHERE id='d4de0000-2000-4000-8000-000000000303')
WHERE id=(SELECT id FROM seed_people WHERE n=12);
-- Test setup only: initialize fixture status without any application trigger.
UPDATE dinner_app.profiles p SET account_status=CASE
 WHEN p.suspended_until>now() THEN 'suspended'
 WHEN u.email_confirmed_at IS NULL THEN 'not_verified' ELSE 'active' END
FROM auth.users u WHERE u.id=p.id AND p.id IN(SELECT id FROM seed_people);
INSERT INTO dinner_app.dinner_updates(id,dinner_id,kind,body,created_at) VALUES
('d4de0000-4000-4000-8000-000000000001','d4de0000-2000-4000-8000-000000000001','comment','TEST ANNOUNCEMENT: Please review the dietary details in the app.',now()-interval '4 hours'),
('d4de0000-4000-4000-8000-000000000002','d4de0000-2000-4000-8000-000000000002','details_changed','TEST UPDATE: The example arrival instructions have changed.',now()-interval '3 hours'),
('d4de0000-4000-4000-8000-000000000003','d4de0000-2000-4000-8000-000000000005','cancelled','TEST CANCELLATION: This fictional dinner is cancelled.',now()-interval '2 hours');
-- Paused pending/retry examples cannot be claimed by a normal worker today.
INSERT INTO dinner_app.email_outbox(id,update_id,recipient_id,sent_at,available_at,attempt_count,last_error)
SELECT ('d4de0000-5000-4000-8000-'||lpad(row_number() OVER(ORDER BY u.id,r.student_id)::text,12,'0'))::uuid,
 u.id,r.student_id,
 CASE WHEN r.student_id=(SELECT id FROM seed_people WHERE n=5) THEN now()-interval '1 hour' ELSE NULL END,
 CASE WHEN r.student_id=(SELECT id FROM seed_people WHERE n=5) THEN now()-interval '4 hours' ELSE now()+interval '100 years' END,
 CASE WHEN r.student_id=(SELECT id FROM seed_people WHERE n=5) THEN 1
      WHEN r.student_id=(SELECT id FROM seed_people WHERE n=6) THEN 2 ELSE 0 END,
 CASE WHEN r.student_id=(SELECT id FROM seed_people WHERE n=6) THEN 'SIMULATED provider timeout; delivery paused' ELSE NULL END
FROM dinner_app.dinner_updates u JOIN dinner_app.registrations r ON r.dinner_id=u.dinner_id
WHERE u.id::text LIKE 'd4de0000-4000-4000-8000-%';
SELECT s.full_name,s.email,s.scenario,p.account_status FROM seed_people s
JOIN dinner_app.profiles p ON p.id=s.id ORDER BY s.n;
COMMIT;

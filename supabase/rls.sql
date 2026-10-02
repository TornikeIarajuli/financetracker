-- Lock the finance_data row to your own Supabase account.
-- This only changes access rules; it does not modify or delete any data.
--
-- Order matters:
--   1. Supabase → Authentication → Users → "Add user": your email + a password
--      (tick "Auto confirm user").
--   2. Supabase → Authentication → Sign In / Providers → Email:
--      turn OFF "Allow new users to sign up".
--   3. Sign in on the web app (Reports → იმპორტი/ექსპორტი) and in the mobile app
--      (Reports tab), and check both show "synced".
--   4. Replace YOUR_EMAIL below and run this in the SQL Editor.

ALTER TABLE finance_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner only" ON finance_data;
CREATE POLICY "owner only" ON finance_data
  FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') = 'YOUR_EMAIL')
  WITH CHECK ((auth.jwt() ->> 'email') = 'YOUR_EMAIL');

-- Check: this should list the policy above.
-- SELECT * FROM pg_policies WHERE tablename = 'finance_data';

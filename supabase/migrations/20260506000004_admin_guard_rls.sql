-- Allow authenticated users to check if their own email is in admin_users
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_users_self_check" ON admin_users
  FOR SELECT USING (email = auth.jwt() ->> 'email');

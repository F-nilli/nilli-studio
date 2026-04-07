-- Add password_changed column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed boolean DEFAULT false;

-- Mark existing active users as having already set their password
UPDATE users SET password_changed = true
WHERE email IN ('ali@nillistudio.com', 'eph@nillistudio.com', 'francis@nillistudio.com');

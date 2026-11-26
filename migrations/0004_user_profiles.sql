-- User management: full name, default landing screen, and the four roles
-- (admin, manager, staff, contractor). SQLite cannot change a CHECK constraint in
-- place, so AppUser is rebuilt. No other table references AppUser.

CREATE TABLE IF NOT EXISTS AppUser_new (
  username TEXT PRIMARY KEY,
  fullName TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'staff', 'contractor')),
  defaultScreen TEXT NOT NULL DEFAULT '/quick-scanner' CHECK (defaultScreen IN ('/dashboard', '/quick-scanner')),
  passwordHash TEXT NOT NULL,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Existing accounts keep their role. Admins land on the dashboard, everyone else on the quick scanner.
INSERT INTO AppUser_new (username, fullName, role, defaultScreen, passwordHash, updatedAt)
SELECT
  username,
  '',
  role,
  CASE WHEN role = 'admin' THEN '/dashboard' ELSE '/quick-scanner' END,
  passwordHash,
  updatedAt
FROM AppUser;

DROP TABLE AppUser;
ALTER TABLE AppUser_new RENAME TO AppUser;

-- budi is the admin account.
UPDATE AppUser SET role = 'admin', defaultScreen = '/dashboard' WHERE username = 'budi';

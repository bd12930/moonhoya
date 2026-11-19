-- App login accounts. Passwords are stored only as PBKDF2-SHA256 hashes.
CREATE TABLE IF NOT EXISTS AppUser (
  username TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  passwordHash TEXT NOT NULL,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed accounts. All start with the default password "setiawan".
INSERT OR IGNORE INTO AppUser (username, role, passwordHash) VALUES
  ('budi', 'admin', 'pbkdf2-sha256$100000$XO73EcLfwIdpIJyvYlfWUA==$oCFpw6AOpGQc7rJnn9wTJAfyzwjHsKxxd3rk4QSZ32A='),
  ('shitarini', 'staff', 'pbkdf2-sha256$100000$R9Zc8dggVM5fSA3EbEEyQQ==$2v1xBvqdGqC0xOWm3XjUxAWAnu3vIhdLNyQXKT81DlM='),
  ('andy', 'staff', 'pbkdf2-sha256$100000$/cDnxYWGqPRj3cfDAlbfBw==$ZcrKPqH2i0EXw3RzGuy2oh3c8nr+qF88i4r/j7cmkiQ='),
  ('debora', 'staff', 'pbkdf2-sha256$100000$7o89dsGpnb1+2q9ddziL4Q==$keddDkMnkhc+Rcl2rp4g539L7g8nQxrYTrUOsMnWVIs=');

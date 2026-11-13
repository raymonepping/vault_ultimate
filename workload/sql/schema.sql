-- workload/sql/schema.sql: Tidewell's booking database (fictional data).
-- Run as postgres over the local socket (peer) by ansible/before-estate.yml,
-- idempotent. The privileges live on the group role booking_rw: the before
-- estate's static booking_app is a member, and from act 2 every dynamic
-- credential Vault creates is granted booking_rw instead.
CREATE TABLE IF NOT EXISTS crossings (
  id text PRIMARY KEY CHECK (id ~ '^d[0-9]-[0-9]{4}$'),
  day int NOT NULL CHECK (day BETWEEN 1 AND 9),
  departs text NOT NULL CHECK (departs ~ '^[0-2][0-9]:[0-5][0-9]$'),
  from_port text NOT NULL,
  to_port text NOT NULL,
  seats int NOT NULL CHECK (seats > 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled'))
);
CREATE TABLE IF NOT EXISTS passengers (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  vehicle_plate text,
  synthetic boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS bookings (
  id serial PRIMARY KEY,
  crossing_id text NOT NULL REFERENCES crossings (id),
  passenger_id int NOT NULL REFERENCES passengers (id),
  cabin text,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'rebooked', 'cancelled')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'seed'
);
CREATE INDEX IF NOT EXISTS bookings_crossing ON bookings (crossing_id, status);
CREATE TABLE IF NOT EXISTS support_notes (
  id serial PRIMARY KEY,
  author text NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'booking_rw') THEN
    CREATE ROLE booking_rw NOLOGIN;
    RAISE NOTICE 'VULT_CHANGED role booking_rw';
  END IF;
END $$;
GRANT CONNECT ON DATABASE tidewell TO booking_rw;
GRANT SELECT, INSERT, UPDATE ON crossings, passengers, bookings, support_notes TO booking_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO booking_rw;

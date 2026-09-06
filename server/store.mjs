import { DatabaseSync } from 'node:sqlite'

export function createStore(filename) {
  const db = new DatabaseSync(filename)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS nonces (
      digest TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      binding TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sensors (
      id TEXT PRIMARY KEY,
      operator_address TEXT NOT NULL,
      public_key BLOB NOT NULL UNIQUE,
      model TEXT NOT NULL,
      firmware TEXT NOT NULL,
      calibration_status TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'challenged',
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS used_payloads (
      digest TEXT PRIMARY KEY,
      accepted_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_digest TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('seeker', 'contributor')),
      device_handle_digest TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      seeker_address TEXT NOT NULL,
      invited_contributor TEXT NOT NULL,
      location_ciphertext TEXT NOT NULL,
      public_cell TEXT NOT NULL,
      window_starts_at INTEGER NOT NULL,
      window_ends_at INTEGER NOT NULL,
      price_luna INTEGER NOT NULL,
      share_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      accepted_by TEXT,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id TEXT PRIMARY KEY,
      sensor_id TEXT NOT NULL REFERENCES sensors(id),
      request_id TEXT NOT NULL REFERENCES requests(id),
      payload_digest TEXT NOT NULL UNIQUE,
      temperature_c REAL NOT NULL,
      humidity_percent REAL NOT NULL,
      observed_at INTEGER NOT NULL,
      accepted_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS connectivity_measurements (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES requests(id),
      payload_digest TEXT NOT NULL UNIQUE,
      endpoint TEXT NOT NULL,
      download_mbps REAL NOT NULL,
      upload_mbps REAL NOT NULL,
      latency_ms REAL NOT NULL,
      jitter_ms REAL NOT NULL,
      location_ciphertext TEXT,
      location_accuracy_m REAL,
      network_type TEXT,
      client_context TEXT,
      measured_at INTEGER NOT NULL,
      accepted_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE REFERENCES requests(id),
      seeker_address TEXT NOT NULL,
      contributor_address TEXT NOT NULL,
      price_luna INTEGER NOT NULL,
      preview_json TEXT NOT NULL,
      report_json TEXT NOT NULL,
      scorer_version TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL UNIQUE REFERENCES reports(id),
      seeker_address TEXT NOT NULL,
      contributor_address TEXT NOT NULL,
      expected_luna INTEGER NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      transaction_hash TEXT,
      state TEXT NOT NULL,
      unlocked_at INTEGER
    ) STRICT;
  `)
  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all().map((column) => column.name)
  if (!sessionColumns.includes('device_handle_digest')) db.exec('ALTER TABLE sessions ADD COLUMN device_handle_digest TEXT')
  const connectivityColumns = db.prepare('PRAGMA table_info(connectivity_measurements)').all().map((column) => column.name)
  if (!connectivityColumns.includes('location_ciphertext')) db.exec('ALTER TABLE connectivity_measurements ADD COLUMN location_ciphertext TEXT')
  if (!connectivityColumns.includes('location_accuracy_m')) db.exec('ALTER TABLE connectivity_measurements ADD COLUMN location_accuracy_m REAL')
  if (!connectivityColumns.includes('network_type')) db.exec('ALTER TABLE connectivity_measurements ADD COLUMN network_type TEXT')
  if (!connectivityColumns.includes('client_context')) db.exec('ALTER TABLE connectivity_measurements ADD COLUMN client_context TEXT')
  return db
}

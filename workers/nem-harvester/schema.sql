-- D1 Database Schema for NEM Harvester

-- Index of stored day files
CREATE TABLE IF NOT EXISTS day_index (
  region TEXT NOT NULL,
  date TEXT NOT NULL,
  key TEXT NOT NULL,
  points INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region, date)
);

-- System state tracking
CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Backfill job tracking
CREATE TABLE IF NOT EXISTS harvest_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_day_index_date ON day_index(date);
CREATE INDEX idx_day_index_updated ON day_index(updated_at);
CREATE INDEX idx_harvest_jobs_status ON harvest_jobs(status);
CREATE INDEX idx_harvest_jobs_created ON harvest_jobs(created_at);
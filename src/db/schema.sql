-- Canonical entitlement state per user
CREATE TABLE IF NOT EXISTS entitlements (
  user_id         TEXT PRIMARY KEY,
  active          BOOLEAN NOT NULL DEFAULT FALSE,
  source          TEXT NOT NULL DEFAULT 'NONE',   -- STORE | CARRIER | MARKETPLACE | NONE
  expires_at      TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason          TEXT,                            -- last event type or reason for change
  last_event_time BIGINT                           -- eventTimeMs of last applied store event (for out-of-order guard)
);

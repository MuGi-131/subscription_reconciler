-- Canonical entitlement state per user
CREATE TABLE IF NOT EXISTS entitlements (
  user_id         TEXT PRIMARY KEY,
  active          BOOLEAN NOT NULL DEFAULT FALSE,
  source          TEXT NOT NULL DEFAULT 'NONE'
                  CHECK (source IN ('STORE','CARRIER','MARKETPLACE','NONE')),
  expires_at      TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason          TEXT,                            -- last event type or reason for change
  last_event_time BIGINT                           -- eventTimeMs of last applied store event (for out-of-order guard)
);

-- Processed store webhook event IDs (idempotency)
CREATE TABLE IF NOT EXISTS processed_store_events (
  event_id    TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Carrier polling queue: tracks which users need to be polled
-- and implements distributed locking via locked_until
CREATE TABLE IF NOT EXISTS carrier_poll_queue (
  user_id      TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ,
  last_polled  TIMESTAMPTZ
);

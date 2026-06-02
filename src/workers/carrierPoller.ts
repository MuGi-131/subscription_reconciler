import cron from "node-cron";
import { pool } from "../db/pool";
import { CarrierStatus } from "../types";

const CARRIER_BASE_URL =
  process.env.CARRIER_URL || "http://localhost:3000/mock/carrier";
const LOCK_DURATION_MS = 6 * 60 * 1000; // 6 min — covers 5-min interval with buffer

// Claim a single user from the carrier poll queue using SKIP LOCKED.
// Ensures multiple worker instances never poll the same user concurrently.
async function claimNextUser(): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ user_id: string }>(
      `SELECT user_id FROM carrier_poll_queue
       WHERE (locked_until IS NULL OR locked_until < NOW())
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );

    const row = result.rows[0];
    if (row === undefined) {
      await client.query("ROLLBACK");
      return null;
    }

    const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
    await client.query(
      `UPDATE carrier_poll_queue SET locked_until = $1 WHERE user_id = $2`,
      [lockUntil, row.user_id],
    );

    await client.query("COMMIT");
    return row.user_id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function pollUser(userId: string): Promise<void> {
  let status: CarrierStatus;
  try {
    const url = `${CARRIER_BASE_URL}/plan?userId=${encodeURIComponent(userId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      // Transient HTTP error (mock returns 503 for api_error) — leave entitlement unchanged
      console.warn(`Carrier API error for ${userId}: HTTP ${res.status}`);
      return;
    }
    const data = (await res.json()) as { status: CarrierStatus };
    status = data.status;
  } catch (err) {
    console.warn(`Carrier fetch failed for ${userId}:`, err);
    return;
  }

  const active = status === "active";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Only update users whose current source is CARRIER — store/marketplace take precedence
    await client.query(
      `UPDATE entitlements
       SET active = $1,
           source = CASE WHEN $1 THEN 'CARRIER' ELSE 'NONE' END,
           last_changed_at = NOW(),
           reason = $2
       WHERE user_id = $3 AND source = 'CARRIER'`,
      [active, `CARRIER_POLL_${status.toUpperCase()}`, userId],
    );

    await client.query(
      `UPDATE carrier_poll_queue SET last_polled = NOW(), locked_until = NULL WHERE user_id = $1`,
      [userId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function startCarrierPoller(): void {
  // Run every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    try {
      let userId = await claimNextUser();
      while (userId !== null) {
        try {
          await pollUser(userId);
        } catch (err) {
          // Don't let one bad user kill the tick — log and continue
          console.error(`pollUser failed for ${userId}:`, err);
        }
        userId = await claimNextUser();
      }
    } catch (err) {
      console.error("Carrier poller error:", err);
    }
  });

  console.log("Carrier poller started (every 5 min)");
}

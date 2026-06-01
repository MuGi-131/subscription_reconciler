import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { StoreWebhookPayload, StoreEventType, EntitlementSource } from "../types";

// Events that activate premium access
const ACTIVATING_EVENTS = new Set<StoreEventType>([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UN_CANCELLATION",
]);

// Events that revoke premium access
const REVOKING_EVENTS = new Set<StoreEventType>([
  "CANCELLATION",
  "EXPIRATION",
  "BILLING_ISSUE",
]);

// Union of all valid types — derived from the sets above so we never drift
const VALID_STORE_EVENT_TYPES: Set<string> = new Set<string>([
  ...ACTIVATING_EVENTS,
  ...REVOKING_EVENTS,
]);

function parseStoreWebhook(body: unknown): StoreWebhookPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.eventId !== "string") return null;
  if (typeof b.userId !== "string") return null;
  if (typeof b.eventTimeMs !== "number" || !Number.isFinite(b.eventTimeMs)) return null;
  if (typeof b.productId !== "string") return null;
  if (typeof b.type !== "string" || !VALID_STORE_EVENT_TYPES.has(b.type)) return null;
  return {
    eventId: b.eventId,
    userId: b.userId,
    type: b.type as StoreEventType,
    eventTimeMs: b.eventTimeMs,
    productId: b.productId,
  };
}

function parseMarketplaceRevoke(body: unknown): { userIds: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.userIds) || b.userIds.length === 0) return null;
  if (!b.userIds.every((u): u is string => typeof u === "string")) return null;
  return { userIds: b.userIds };
}

const router = Router();

// POST /webhooks/store
router.post("/store", async (req: Request, res: Response) => {
  const payload = parseStoreWebhook(req.body);
  if (!payload) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  const { eventId, userId, type, eventTimeMs } = payload;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotency: skip if already processed
    const dup = await client.query<{ event_id: string }>(
      "SELECT event_id FROM processed_store_events WHERE event_id = $1",
      [eventId],
    );
    if (dup.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(200).json({ status: "duplicate", message: "Event already processed" });
      return;
    }

    // Get current entitlement (lock row for update)
    const current = await client.query<{
      active: boolean;
      source: EntitlementSource;
      last_event_time: string | null;
    }>(
      `SELECT active, source, last_event_time
       FROM entitlements WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    // Out-of-order guard: ignore events older than what we've already applied
    const currentRow = current.rows[0];
    if (currentRow !== undefined) {
      // pg returns BIGINT as a string; convert explicitly so comparisons are numeric
      const lastEventTime =
        currentRow.last_event_time !== null ? Number(currentRow.last_event_time) : null;
      if (lastEventTime !== null && eventTimeMs < lastEventTime) {
        // Mark as processed so we don't re-ingest, but don't change state
        await client.query(
          "INSERT INTO processed_store_events (event_id) VALUES ($1)",
          [eventId],
        );
        await client.query("COMMIT");
        res
          .status(200)
          .json({ status: "ignored", message: "Older event, state unchanged" });
        return;
      }
    }

    const isActivating = ACTIVATING_EVENTS.has(type);
    const newActive = isActivating;
    const newSource: EntitlementSource = newActive ? "STORE" : "NONE";
    const eventTimestamp = new Date(eventTimeMs);

    // Upsert entitlement
    await client.query(
      `INSERT INTO entitlements (user_id, active, source, last_changed_at, reason, last_event_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET active = EXCLUDED.active,
             source = EXCLUDED.source,
             last_changed_at = EXCLUDED.last_changed_at,
             reason = EXCLUDED.reason,
             last_event_time = EXCLUDED.last_event_time`,
      [userId, newActive, newSource, eventTimestamp, type, eventTimeMs],
    );

    // Mark event processed
    await client.query(
      "INSERT INTO processed_store_events (event_id) VALUES ($1)",
      [eventId],
    );

    await client.query("COMMIT");
    res.status(200).json({ status: "ok" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Store webhook error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// POST /webhooks/marketplace/revoke
router.post("/marketplace/revoke", async (req: Request, res: Response) => {
  const parsed = parseMarketplaceRevoke(req.body);
  if (!parsed) {
    res.status(400).json({ error: "userIds must be a non-empty array of strings" });
    return;
  }
  const { userIds } = parsed;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Only revoke users whose current source is MARKETPLACE
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
    const result = await client.query<{ user_id: string }>(
      `UPDATE entitlements
       SET active = FALSE,
           source = 'NONE',
           last_changed_at = NOW(),
           reason = 'MARKETPLACE_BULK_REVOKE'
       WHERE user_id IN (${placeholders})
         AND source = 'MARKETPLACE'
       RETURNING user_id`,
      userIds,
    );

    await client.query("COMMIT");
    res.status(200).json({
      status: "ok",
      revokedCount: result.rowCount ?? 0,
      revokedUsers: result.rows.map((r) => r.user_id),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Marketplace revoke error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;

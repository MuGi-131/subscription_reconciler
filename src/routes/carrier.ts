import { Router, Request, Response } from "express";
import { pool } from "../db/pool";

const router = Router();

function parseEnroll(body: unknown): { userIds: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.userIds) || b.userIds.length === 0) return null;
  if (!b.userIds.every((u): u is string => typeof u === "string")) return null;
  return { userIds: b.userIds };
}

// POST /carrier/enroll — adds userIds to the carrier poll queue (idempotent).
// Also seeds entitlement rows with source=CARRIER (inactive) so the poller's
// `WHERE source = 'CARRIER'` filter has something to update.
// Existing entitlement rows (any source) are left untouched — store/marketplace win.
router.post("/enroll", async (req: Request, res: Response) => {
  const parsed = parseEnroll(req.body);
  if (!parsed) {
    res.status(400).json({ error: "userIds must be a non-empty array of strings" });
    return;
  }
  const { userIds } = parsed;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO entitlements (user_id, active, source, reason, last_changed_at)
       SELECT unnest($1::text[]), false, 'CARRIER', 'CARRIER_ENROLLED', NOW()
       ON CONFLICT (user_id) DO NOTHING`,
      [userIds],
    );

    const result = await client.query<{ user_id: string }>(
      `INSERT INTO carrier_poll_queue (user_id)
       SELECT unnest($1::text[])
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id`,
      [userIds],
    );

    await client.query("COMMIT");
    res.status(200).json({
      status: "ok",
      newlyEnrolledCount: result.rowCount ?? 0,
      newlyEnrolled: result.rows.map((r) => r.user_id),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Carrier enroll error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;

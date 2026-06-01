import { Router, Request, Response } from "express";
import { pool } from "../db/pool";

const router = Router();

// GET /users/:id/entitlement
router.get("/:id/entitlement", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT active, source, expires_at, last_changed_at, reason
       FROM entitlements WHERE user_id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      res.json({
        active: false,
        source: "NONE",
        expiresAt: null,
        lastChangedAt: null,
        reason: null,
      });
      return;
    }

    const row = result.rows[0];
    res.json({
      active: row.active,
      source: row.source,
      expiresAt: row.expires_at ?? null,
      lastChangedAt: row.last_changed_at,
      reason: row.reason ?? null,
    });
  } catch (err) {
    console.error("Entitlement read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

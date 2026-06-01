import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { Entitlement, DbEntitlement } from "../types";

const router = Router();

// GET /users/:id/entitlement
router.get("/:id/entitlement", async (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    const result = await pool.query<DbEntitlement>(
      `SELECT user_id, active, source, expires_at, last_changed_at, reason
       FROM entitlements WHERE user_id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      const defaultEntitlement: Entitlement = {
        userId: id,
        active: false,
        source: "NONE",
        expiresAt: null,
        lastChangedAt: new Date(),
        reason: null,
      };
      res.json(defaultEntitlement);
      return;
    }

    const row = result.rows[0];
    if (!row) {
      // This case is already covered by result.rows.length === 0, 
      // but satisfies TS strict null checks.
      res.status(404).json({ error: "Entitlement not found" });
      return;
    }
    const entitlement: Entitlement = {
      userId: row.user_id,
      active: row.active,
      source: row.source,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      lastChangedAt: new Date(row.last_changed_at),
      reason: row.reason,
    };

    res.json(entitlement);
  } catch (err) {
    console.error("Entitlement read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

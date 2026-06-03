import cron from "node-cron";
import { pool } from "../db/pool";

export async function dispatchPending(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Claim due notifications. SKIP LOCKED so multiple workers never race on the same row.
    const result = await client.query<{ id: number; user_id: string; type: string }>(
      `SELECT id, user_id, type FROM notifications
       WHERE sent_at IS NULL AND scheduled_for <= NOW()
       FOR UPDATE SKIP LOCKED
       LIMIT 100`,
    );

    for (const row of result.rows) {
      // Real systems send email/push here. For this build we log and mark sent.
      console.log(`[notification] ${row.type} -> user=${row.user_id} (id=${row.id})`);
      await client.query(
        `UPDATE notifications SET sent_at = NOW() WHERE id = $1`,
        [row.id],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function startNotificationWorker(): void {
  cron.schedule("* * * * *", async () => {
    try {
      await dispatchPending();
    } catch (err) {
      console.error("Notification worker error:", err);
    }
  });

  console.log("Notification worker started (every 1 min)");
}

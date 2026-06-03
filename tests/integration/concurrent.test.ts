/**
 * Integration test for concurrent worker safety.
 *
 * Requires a running Postgres (e.g. `docker compose up -d db`).
 * Connects two separate clients to simulate two workers racing on the same queue.
 *
 * The production claim query lives in src/workers/carrierPoller.ts (claimNextUser).
 * We keep the SQL in sync here — if you change one, change the other.
 */

import { Client } from "pg";
import fs from "fs";
import path from "path";

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "reconciler",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
};

const CLAIM_SQL = `
  SELECT user_id FROM carrier_poll_queue
   WHERE (locked_until IS NULL OR locked_until < NOW())
   LIMIT 1
   FOR UPDATE SKIP LOCKED
`;

describe("concurrent carrier poll claim (FOR UPDATE SKIP LOCKED)", () => {
  let workerA: Client;
  let workerB: Client;

  beforeAll(async () => {
    // Ensure schema exists (idempotent — schema.sql uses IF NOT EXISTS)
    const bootstrap = new Client(DB_CONFIG);
    await bootstrap.connect();
    const schema = fs.readFileSync(
      path.join(__dirname, "../../src/db/schema.sql"),
      "utf8",
    );
    await bootstrap.query(schema);
    await bootstrap.end();

    workerA = new Client(DB_CONFIG);
    workerB = new Client(DB_CONFIG);
    await workerA.connect();
    await workerB.connect();
  });

  afterAll(async () => {
    await workerA.end();
    await workerB.end();
  });

  beforeEach(async () => {
    // Clean slate: exactly one queued user, no locks
    await workerA.query("TRUNCATE carrier_poll_queue");
    await workerA.query(
      "INSERT INTO carrier_poll_queue (user_id) VALUES ('u_race_test')",
    );
  });

  it("only one in-flight transaction can claim a given row", async () => {
    await workerA.query("BEGIN");
    await workerB.query("BEGIN");

    // Worker A claims first — gets the row, holds the lock until commit/rollback
    const resA = await workerA.query<{ user_id: string }>(CLAIM_SQL);
    expect(resA.rows).toHaveLength(1);
    expect(resA.rows[0]!.user_id).toBe("u_race_test");

    // Worker B tries to claim while A is still in transaction.
    // FOR UPDATE SKIP LOCKED makes B see nothing instead of blocking.
    const resB = await workerB.query<{ user_id: string }>(CLAIM_SQL);
    expect(resB.rows).toHaveLength(0);

    await workerA.query("ROLLBACK");
    await workerB.query("ROLLBACK");
  });

  it("a committed claim with future locked_until blocks subsequent claims", async () => {
    // Worker A: claim, set lock, commit
    await workerA.query("BEGIN");
    const claim = await workerA.query<{ user_id: string }>(CLAIM_SQL);
    expect(claim.rows).toHaveLength(1);

    await workerA.query(
      `UPDATE carrier_poll_queue
         SET locked_until = NOW() + INTERVAL '6 minutes'
         WHERE user_id = $1`,
      [claim.rows[0]!.user_id],
    );
    await workerA.query("COMMIT");

    // Worker B: even with no transaction conflict, the WHERE filter on
    // locked_until hides the row from us.
    const resB = await workerB.query<{ user_id: string }>(CLAIM_SQL);
    expect(resB.rows).toHaveLength(0);
  });

  it("an expired locked_until allows re-claim by a different worker", async () => {
    // Simulate a worker that crashed mid-poll — locked_until is in the past
    await workerA.query(
      `UPDATE carrier_poll_queue
         SET locked_until = NOW() - INTERVAL '1 minute'
         WHERE user_id = 'u_race_test'`,
    );

    const resB = await workerB.query<{ user_id: string }>(CLAIM_SQL);
    expect(resB.rows).toHaveLength(1);
    expect(resB.rows[0]!.user_id).toBe("u_race_test");
  });
});

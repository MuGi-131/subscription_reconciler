import request from "supertest";
import app from "../src/app";
import { pool } from "../src/db/pool";
import { dispatchPending } from "../src/workers/notificationWorker";

jest.mock("../src/db/pool", () => ({
  pool: { connect: jest.fn(), query: jest.fn() },
}));

const mockConnect = pool.connect as jest.Mock;

function makeClient(): { query: jest.Mock; release: jest.Mock } {
  const client = { query: jest.fn(), release: jest.fn() };
  mockConnect.mockResolvedValue(client);
  return client;
}

const validPayload = {
  eventId: "evt_n1",
  userId: "u_n1",
  type: "INITIAL_PURCHASE",
  eventTimeMs: 1716700000000, // 2024-05-26
  productId: "premium_monthly",
};

describe("notification scheduling (via store webhook)", () => {
  it("schedules a PREMIUM_EXPIRES_SOON notification for known product", async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // dup check
      .mockResolvedValueOnce({ rows: [] }) // current entitlement
      .mockResolvedValueOnce(undefined) // UPSERT entitlements
      .mockResolvedValueOnce(undefined) // INSERT notifications
      .mockResolvedValueOnce(undefined) // INSERT processed_events
      .mockResolvedValueOnce(undefined); // COMMIT

    await request(app).post("/webhooks/store").send(validPayload);

    const notificationCall = client.query.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("INSERT INTO notifications"),
    );
    expect(notificationCall).toBeDefined();

    // ON CONFLICT DO NOTHING is what enforces "scheduled once only" at the DB layer
    expect(notificationCall![0] as string).toContain("ON CONFLICT");
    expect(notificationCall![0] as string).toContain("DO NOTHING");

    // scheduled_for = eventTime + 30d - 7d = +23 days
    const params = notificationCall![1] as [string, Date];
    expect(params[0]).toBe("u_n1");
    const expected = new Date(1716700000000 + 23 * 24 * 60 * 60 * 1000);
    expect(params[1].toISOString()).toBe(expected.toISOString());
  });

  it("does not schedule a notification when productId is unknown", async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // dup check
      .mockResolvedValueOnce({ rows: [] }) // current entitlement
      .mockResolvedValueOnce(undefined) // UPSERT entitlements
      // no notification INSERT — expires_at is null for unknown products
      .mockResolvedValueOnce(undefined) // INSERT processed_events
      .mockResolvedValueOnce(undefined); // COMMIT

    await request(app)
      .post("/webhooks/store")
      .send({ ...validPayload, productId: "unknown_sku" });

    const notificationCall = client.query.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("INSERT INTO notifications"),
    );
    expect(notificationCall).toBeUndefined();
  });

  it("does not schedule a notification for revoking events", async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // dup check
      .mockResolvedValueOnce({ rows: [] }) // current entitlement
      .mockResolvedValueOnce(undefined) // UPSERT entitlements (with expires_at = null)
      .mockResolvedValueOnce(undefined) // INSERT processed_events
      .mockResolvedValueOnce(undefined); // COMMIT

    await request(app)
      .post("/webhooks/store")
      .send({ ...validPayload, type: "CANCELLATION" });

    const notificationCall = client.query.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("INSERT INTO notifications"),
    );
    expect(notificationCall).toBeUndefined();
  });
});

describe("dispatchPending (notification worker)", () => {
  it("marks pending notifications as sent", async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          { id: 1, user_id: "u_a", type: "PREMIUM_EXPIRES_SOON" },
          { id: 2, user_id: "u_b", type: "PREMIUM_EXPIRES_SOON" },
        ],
      }) // SELECT pending
      .mockResolvedValueOnce(undefined) // UPDATE id=1
      .mockResolvedValueOnce(undefined) // UPDATE id=2
      .mockResolvedValueOnce(undefined); // COMMIT

    await dispatchPending();

    const updateCalls = client.query.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("SET sent_at = NOW()"),
    );
    expect(updateCalls).toHaveLength(2);
    expect((updateCalls[0]![1] as number[])[0]).toBe(1);
    expect((updateCalls[1]![1] as number[])[0]).toBe(2);
  });

  it("uses FOR UPDATE SKIP LOCKED so multiple workers never claim the same row", async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT (empty)
      .mockResolvedValueOnce(undefined); // COMMIT

    await dispatchPending();

    const selectCall = client.query.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("FROM notifications"),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall![0] as string).toContain("FOR UPDATE SKIP LOCKED");
  });
});

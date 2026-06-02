import request from "supertest";
import app from "../src/app";
import { pool } from "../src/db/pool";

jest.mock("../src/db/pool", () => ({
  pool: {
    connect: jest.fn(),
    query: jest.fn(),
  },
}));

const mockConnect = pool.connect as jest.Mock;

function makeClient(): { query: jest.Mock; release: jest.Mock } {
  const client = { query: jest.fn(), release: jest.fn() };
  mockConnect.mockResolvedValue(client);
  return client;
}

const validStorePayload = {
  eventId: "evt_1",
  userId: "u_1",
  type: "INITIAL_PURCHASE",
  eventTimeMs: 1716700000000,
  productId: "premium_monthly",
};

describe("POST /webhooks/store", () => {
  it("returns 400 when required fields are missing", async () => {
    const res = await request(app).post("/webhooks/store").send({ userId: "u_1" });

    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns 400 when type is not a known event", async () => {
    const res = await request(app)
      .post("/webhooks/store")
      .send({ ...validStorePayload, type: "NOT_A_REAL_TYPE" });

    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns 'duplicate' when the event was already processed", async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ event_id: "evt_1" }] }) // dup check finds it
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const res = await request(app).post("/webhooks/store").send(validStorePayload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "duplicate" });
  });

  it("ignores an out-of-order (older) event but still records the event_id", async () => {
    // Stored last_event_time is newer than the incoming event — guard should fire.
    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // dup check empty
      .mockResolvedValueOnce({
        rows: [
          { active: true, source: "STORE", last_event_time: "1716800000000" }, // newer than payload's 1716700000000
        ],
      })
      .mockResolvedValueOnce(undefined) // INSERT processed_events (for idempotency)
      .mockResolvedValueOnce(undefined); // COMMIT

    const res = await request(app)
      .post("/webhooks/store")
      .send({ ...validStorePayload, type: "CANCELLATION" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ignored" });

    // Critical: the entitlement upsert must NOT have run
    const upsertCall = client.query.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO entitlements"),
    );
    expect(upsertCall).toBeUndefined();
  });
});

describe("POST /webhooks/marketplace/revoke", () => {
  it("returns 400 when userIds contains a non-string", async () => {
    const res = await request(app)
      .post("/webhooks/marketplace/revoke")
      .send({ userIds: [1, 2, 3] });

    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("revokes only MARKETPLACE-sourced users and returns them", async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: "u_mp" }] }) // UPDATE returns 1
      .mockResolvedValueOnce(undefined); // COMMIT

    const res = await request(app)
      .post("/webhooks/marketplace/revoke")
      .send({ userIds: ["u_mp", "u_store"] });

    expect(res.status).toBe(200);
    expect(res.body.revokedCount).toBe(1);
    expect(res.body.revokedUsers).toEqual(["u_mp"]);

    // Verify the UPDATE filters on source = 'MARKETPLACE'
    const updateCall = client.query.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).includes("source = 'MARKETPLACE'"),
    );
    expect(updateCall).toBeDefined();
  });
});

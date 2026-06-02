import request from "supertest";
import app from "../src/app";
import { pool } from "../src/db/pool";

jest.mock("../src/db/pool", () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockQuery = pool.query as jest.Mock;

describe("GET /users/:id/entitlement", () => {
  it("returns the stored entitlement when the user exists", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: "u_1",
          active: true,
          source: "STORE",
          expires_at: null,
          last_changed_at: new Date("2024-05-26T05:06:40.000Z"),
          reason: "INITIAL_PURCHASE",
          last_event_time: "1716700000000",
        },
      ],
    });

    const res = await request(app).get("/users/u_1/entitlement");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: "u_1",
      active: true,
      source: "STORE",
      expiresAt: null,
      reason: "INITIAL_PURCHASE",
    });
  });

  it("returns a synthesized NONE response when the user is unknown", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get("/users/u_never_seen/entitlement");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      active: false,
      source: "NONE",
      reason: null,
    });
  });

  it("returns 500 when the DB query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection lost"));

    const res = await request(app).get("/users/u_1/entitlement");

    expect(res.status).toBe(500);
  });
});

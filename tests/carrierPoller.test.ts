import { pollUser } from "../src/workers/carrierPoller";
import { pool } from "../src/db/pool";

jest.mock("../src/db/pool", () => ({
  pool: { connect: jest.fn() },
}));

const mockConnect = pool.connect as jest.Mock;

function makeClient(): { query: jest.Mock; release: jest.Mock } {
  const client = { query: jest.fn(), release: jest.fn() };
  mockConnect.mockResolvedValue(client);
  return client;
}

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("pollUser", () => {
  it("updates entitlement to inactive when carrier returns 'inactive'", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "inactive" }),
    });

    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE entitlements
      .mockResolvedValueOnce(undefined) // UPDATE queue
      .mockResolvedValueOnce(undefined); // COMMIT

    await pollUser("u_1");

    const updateEntitlementCall = client.query.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("UPDATE entitlements"),
    );
    expect(updateEntitlementCall).toBeDefined();
    expect(updateEntitlementCall![1]).toEqual([false, "CARRIER_POLL_INACTIVE", "u_1"]);
  });

  it("leaves entitlement unchanged on HTTP 5xx (transient API error)", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
    });

    await pollUser("u_1");

    // No DB connection should have been opened — early return
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("only updates rows where source = 'CARRIER' (store/marketplace take precedence)", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "active" }),
    });

    const client = makeClient();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // UPDATE entitlements
      .mockResolvedValueOnce(undefined) // UPDATE queue
      .mockResolvedValueOnce(undefined); // COMMIT

    await pollUser("u_1");

    const updateCall = client.query.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("UPDATE entitlements") &&
        (call[0] as string).includes("source = 'CARRIER'"),
    );
    expect(updateCall).toBeDefined();
  });
});

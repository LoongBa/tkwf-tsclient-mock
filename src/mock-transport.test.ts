import { describe, it, expect } from "vitest";
import { MockTransport } from "./mock-transport";

describe("MockTransport", () => {
  it("returns handler result for known field", async () => {
    const transport = new MockTransport({
      ping: () => ({ pong: true }),
    });

    const result = await transport.execute({ field: "ping", type: "query" });
    expect(result).toEqual({ pong: true });
  });

  it("throws for unknown field", async () => {
    const transport = new MockTransport({});

    await expect(
      transport.execute({ field: "unknown", type: "query" }),
    ).rejects.toThrow(/no handler for "unknown"/);
  });

  it("applies global delay", async () => {
    const transport = new MockTransport(
      { ping: () => ({ pong: true }) },
      { delayMs: 10 },
    );

    const start = Date.now();
    await transport.execute({ field: "ping", type: "query" });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(8);
  });

  it("applies per-field delay overriding global", async () => {
    const transport = new MockTransport(
      { ping: () => ({ pong: true }) },
      { delayMs: 50, fieldOptions: { ping: { delayMs: 5 } } },
    );

    const start = Date.now();
    await transport.execute({ field: "ping", type: "query" });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(3);
    expect(elapsed).toBeLessThan(40);
  });

  it("throws simulated failure when failRate triggers", async () => {
    const transport = new MockTransport(
      { ping: () => ({ pong: true }) },
      { fieldOptions: { ping: { failRate: 1 } } },
    );

    await expect(
      transport.execute({ field: "ping", type: "query" }),
    ).rejects.toThrow(/simulated failure for "ping"/);
  });

  it("throws injected error from fieldOptions", async () => {
    const transport = new MockTransport(
      { ping: () => ({ pong: true }) },
      { fieldOptions: { ping: { error: new Error("custom error") } } },
    );

    await expect(
      transport.execute({ field: "ping", type: "query" }),
    ).rejects.toThrow("custom error");
  });

  it("times out when handler exceeds timeoutMs", async () => {
    const transport = new MockTransport(
      {
        slow: async () => {
          await new Promise((r) => setTimeout(r, 100));
          return { done: true };
        },
      },
      { fieldOptions: { slow: { timeoutMs: 10 } } },
    );

    await expect(
      transport.execute({ field: "slow", type: "query" }),
    ).rejects.toThrow(/timeout for "slow"/);
  });

  it("extracts field from named operation query", async () => {
    const transport = new MockTransport({
      paymentLog: () => ({ id: "1" }),
    });

    const result = await transport.executeRawGraphQL(
      'query GetPaymentLog { paymentLog(id: "1") { id } }',
    );
    expect(result).toEqual({ id: "1" });
  });

  it("extracts field from multi-line query with comments", async () => {
    const transport = new MockTransport({
      me: () => ({ name: "Alice" }),
    });

    const result = await transport.executeRawGraphQL(`
      # Get current user
      query { # inline comment
        me {
          id
          name
        }
      }
    `);
    expect(result).toEqual({ name: "Alice" });
  });

  it("extracts field from mutation with nested fields", async () => {
    const transport = new MockTransport({
      createOrder: () => ({ id: "42" }),
    });

    const result = await transport.executeRawGraphQL(
      "mutation { createOrder(input: { items: [] }) { id } }",
    );
    expect(result).toEqual({ id: "42" });
  });

  it("takes first top-level field when multiple exist", async () => {
    const transport = new MockTransport({
      user: () => ({ name: "Alice" }),
    });

    const result = await transport.executeRawGraphQL(
      "query { user { id } me { id } }",
    );
    expect(result).toEqual({ name: "Alice" });
  });

  it("throws when field cannot be extracted", async () => {
    const transport = new MockTransport({});

    await expect(
      transport.executeRawGraphQL("not a query at all"),
    ).rejects.toThrow(/unable to extract field from raw query/);
  });
});
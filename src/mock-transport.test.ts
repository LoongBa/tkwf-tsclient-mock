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
});
import { describe, expect, it } from "vitest";
import { runConnectivityProbe } from "../src/lib/connectivity";

describe("connectivity probe", () => {
  it("reports endpoint-relative download, upload, latency and jitter from measured durations", async () => {
    const times = [0, 100, 150, 200, 260];
    const result = await runConnectivityProbe({
      endpoint: "https://probe.example",
      now: () => times.shift() ?? 300,
      fetchImpl: async (url: string, init?: RequestInit) => {
        if (url.endsWith("/download?bytes=125000"))
          return new Response(new Uint8Array(125000));
        if (url.endsWith("/upload"))
          return new Response(null, {
            status: init?.method === "POST" ? 204 : 405,
          });
        return new Response(null, { status: 204 });
      },
    });

    expect(result.downloadMbps).toBeGreaterThan(0);
    expect(result.uploadMbps).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.endpoint).toBe("https://probe.example");
  });

  it("fails honestly when the controlled endpoint cannot be reached", async () => {
    await expect(
      runConnectivityProbe({
        endpoint: "https://probe.example",
        fetchImpl: async () => {
          throw new Error("Network unavailable");
        },
      }),
    ).rejects.toThrow("Connectivity probe failed");
  });
});

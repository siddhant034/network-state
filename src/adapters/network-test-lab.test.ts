import { describe, expect, it, vi } from "vitest";
import { parseNetworkLabEndpoints, runNetworkLab, type NetworkLabEndpoint } from "./network-test-lab";

const response = (status: number) => ({ status, ok: status >= 200 && status < 300 }) as Response;
const endpoint = (id: string, url: string): NetworkLabEndpoint => ({
  id,
  url,
  label: new URL(url).host
});
const baseOptions = {
  requestsPerEndpoint: 1,
  concurrency: 2,
  timeoutMs: 1_000,
  retries: 0,
  simulatedLatencyMs: 0,
  simulatedFailureRate: 0,
  random: () => 1
};

describe("parseNetworkLabEndpoints", () => {
  it("accepts absolute HTTP endpoints and exposes only host labels", () => {
    const parsed = parseNetworkLabEndpoints("https://api.example.test/health?token=secret\nhttp://status.example.test:8080/ping");
    expect(parsed.errors).toEqual([]);
    expect(parsed.endpoints.map((item) => item.label)).toEqual(["api.example.test", "status.example.test:8080"]);
    expect(parsed.endpoints[0].url).toContain("token=secret");
    expect(parsed.endpoints[0]).not.toHaveProperty("token");
  });

  it("rejects credentials, unsupported protocols, and duplicate endpoints without echoing input", () => {
    const parsed = parseNetworkLabEndpoints("https://user:secret@example.test/health\nfile:///tmp/status\nhttps://example.test/health\nhttps://example.test/health");
    expect(parsed.endpoints).toHaveLength(1);
    expect(parsed.errors).toHaveLength(3);
    expect(parsed.errors.join(" ")).not.toContain("secret");
    expect(parsed.errors.join(" ")).not.toContain("user");
  });

  it("limits a run to five endpoints", () => {
    const parsed = parseNetworkLabEndpoints([
      "https://one.example.test",
      "https://two.example.test",
      "https://three.example.test",
      "https://four.example.test",
      "https://five.example.test",
      "https://six.example.test"
    ].join("\n"));
    expect(parsed.endpoints).toHaveLength(5);
    expect(parsed.errors[0]).toMatch(/limited to five/);
  });
});

describe("runNetworkLab", () => {
  it("compares repeated endpoint requests without exceeding configured concurrency", async () => {
    let active = 0;
    let maximumActive = 0;
    const fetcher = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 4));
      active -= 1;
      return response(204);
    });
    const endpoints = [endpoint("a", "https://a.example.test/health"), endpoint("b", "https://b.example.test/health")];

    const results = await runNetworkLab(endpoints, {
      ...baseOptions,
      requestsPerEndpoint: 3,
      concurrency: 2,
      fetcher
    });

    expect(results).toHaveLength(6);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(maximumActive).toBe(2);
    expect(results.every((result) => result.status === "reachable")).toBe(true);
  });

  it("retries transport failures but does not retry HTTP responses", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(503));
    const results = await runNetworkLab(
      [endpoint("a", "https://a.example.test/health"), endpoint("b", "https://b.example.test/health")],
      { ...baseOptions, concurrency: 1, retries: 2, fetcher }
    );

    expect(results.find((result) => result.endpointLabel === "a.example.test")?.attempts).toBe(2);
    expect(results.find((result) => result.endpointLabel === "b.example.test")).toMatchObject({
      status: "http-error",
      httpStatus: 503,
      attempts: 1
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("marks injected failures separately and never sends the affected request", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(204));
    const results = await runNetworkLab(
      [endpoint("a", "https://a.example.test/health")],
      { ...baseOptions, simulatedFailureRate: 100, random: () => 0, fetcher }
    );

    expect(results[0]).toMatchObject({
      status: "simulated-failure",
      simulatedFailure: true,
      attempts: 1
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("applies simulated latency through the lab fetch wrapper", async () => {
    const delay = vi.fn(async () => undefined);
    const fetcher = vi.fn().mockResolvedValue(response(204));
    const results = await runNetworkLab(
      [endpoint("a", "https://a.example.test/health")],
      { ...baseOptions, simulatedLatencyMs: 250, delay, fetcher }
    );

    expect(delay).toHaveBeenCalledWith(250, expect.any(AbortSignal));
    expect(results[0]).toMatchObject({ status: "reachable", simulatedLatencyMs: 250 });
  });

  it("rejects unsafe workload sizes and stops scheduling when already aborted", async () => {
    await expect(runNetworkLab([endpoint("a", "https://a.example.test")], {
      ...baseOptions,
      requestsPerEndpoint: 11
    })).rejects.toThrow(/requestsPerEndpoint/);

    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn().mockResolvedValue(response(204));
    const results = await runNetworkLab([endpoint("a", "https://a.example.test")], {
      ...baseOptions,
      signal: controller.signal,
      fetcher
    });
    expect(results).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

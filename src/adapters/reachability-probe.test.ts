import { afterEach, describe, expect, it, vi } from "vitest";
import { runReachabilityProbe } from "./reachability-probe";

const response = (status: number, ok = status >= 200 && status < 300) =>
  ({ status, ok }) as Response;

describe("runReachabilityProbe", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("measures a successful endpoint response without sending credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(204));
    const now = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(37);

    const result = await runReachabilityProbe("https://status.example.test/health", {
      fetcher,
      now
    });

    expect(result.status).toBe("reachable");
    expect(result.httpStatus).toBe(204);
    expect(result.durationMs).toBe(27);
    expect(fetcher).toHaveBeenCalledWith(
      "https://status.example.test/health",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      })
    );
  });

  it("distinguishes an HTTP error from a transport failure", async () => {
    const result = await runReachabilityProbe("/health", {
      baseUrl: "https://app.example.test/",
      fetcher: vi.fn().mockResolvedValue(response(503, false))
    });

    expect(result.status).toBe("http-error");
    expect(result.httpStatus).toBe(503);
    expect(result.detail).toContain("host is reachable");
  });

  it("reports a network error when no HTTP response is received", async () => {
    const result = await runReachabilityProbe("https://status.example.test/health", {
      fetcher: vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    });

    expect(result.status).toBe("network-error");
    expect(result.httpStatus).toBeNull();
  });

  it("aborts a request and reports a timeout when the deadline expires", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })
    );

    const pending = runReachabilityProbe("https://status.example.test/health", {
      timeoutMs: 100,
      fetcher
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;

    expect(result.status).toBe("timeout");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("supports caller cancellation", async () => {
    const controller = new AbortController();
    const pending = runReachabilityProbe("https://status.example.test/health", {
      signal: controller.signal,
      fetcher: vi.fn(() => new Promise<Response>(() => undefined))
    });

    controller.abort();
    const result = await pending;

    expect(result.status).toBe("aborted");
  });

  it("rejects unsupported protocols and embedded credentials", async () => {
    const fetcher = vi.fn();

    const protocol = await runReachabilityProbe("file:///etc/passwd", { fetcher });
    const credentials = await runReachabilityProbe("https://user:pass@example.test/health", { fetcher });

    expect(protocol.status).toBe("invalid-endpoint");
    expect(credentials.status).toBe("invalid-endpoint");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a non-positive timeout", async () => {
    await expect(runReachabilityProbe("/health", { timeoutMs: 0, baseUrl: "https://app.test/" }))
      .rejects.toThrow("timeoutMs must be a positive finite number");
  });
});

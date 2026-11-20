import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNetworkMonitor } from "./network-monitor";

describe("createNetworkMonitor", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("starts with the browser's online state", () => {
    const monitor = createNetworkMonitor();
    expect(monitor.getSnapshot().connection.status).toBe("online");
  });

  it("records online and offline transitions", () => {
    const monitor = createNetworkMonitor();
    monitor.start();
    window.dispatchEvent(new Event("offline"));
    expect(monitor.getSnapshot().connection.status).toBe("offline");
    expect(monitor.getSnapshot().events[0].title).toBe("Connection lost");
    window.dispatchEvent(new Event("online"));
    expect(monitor.getSnapshot().connection.status).toBe("online");
    monitor.stop();
  });

  it("marks the connection unstable after consecutive request failures", () => {
    const monitor = createNetworkMonitor({ unstableAfterFailures: 2 });
    monitor.recordRequestFailure({ url: "/api/a", method: "GET", reason: "Failed to fetch" });
    monitor.recordRequestFailure({ url: "/api/b", method: "POST", reason: "Timeout" });
    expect(monitor.getSnapshot().connection.status).toBe("unstable");
    expect(monitor.getSnapshot().consecutiveFailures).toBe(2);
  });

  it("lets a successful HTTP response override the browser's offline hint", () => {
    const monitor = createNetworkMonitor();
    monitor.start();
    window.dispatchEvent(new Event("offline"));
    expect(monitor.getSnapshot().connection.status).toBe("offline");

    monitor.recordRequestSuccess();

    expect(monitor.getSnapshot().connection.status).toBe("online");
    expect(monitor.getSnapshot().events[0].title).toBe("Reachability confirmed");
    monitor.stop();
  });

  it("recovers after a successful request", () => {
    const monitor = createNetworkMonitor({ unstableAfterFailures: 1 });
    monitor.recordRequestFailure({ url: "/api/a", method: "GET", reason: "Timeout" });
    monitor.recordRequestSuccess();
    expect(monitor.getSnapshot().connection.status).toBe("online");
    expect(monitor.getSnapshot().consecutiveFailures).toBe(0);
  });

  it("notifies subscribers and supports unsubscribe", () => {
    const monitor = createNetworkMonitor();
    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);
    monitor.recordRequestFailure({ url: "/api", method: "GET", reason: "Offline" });
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    monitor.recordRequestSuccess();
    expect(listener).not.toHaveBeenCalled();
  });

  it("bounds retained events and failures", () => {
    const monitor = createNetworkMonitor({ maxEvents: 2, maxFailures: 1 });
    monitor.recordRequestFailure({ url: "/one", method: "GET", reason: "failed" });
    monitor.recordRequestFailure({ url: "/two", method: "GET", reason: "failed" });
    monitor.recordRequestFailure({ url: "/three", method: "GET", reason: "failed" });
    expect(monitor.getSnapshot().events).toHaveLength(2);
    expect(monitor.getSnapshot().failures).toHaveLength(1);
  });
});
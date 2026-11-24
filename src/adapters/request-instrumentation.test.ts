import { describe, expect, it, vi } from "vitest";
import {
  installFetchInstrumentation,
  installXhrInstrumentation,
  type InstrumentedRequestEvent
} from "./request-instrumentation";

const makeFetch = (implementation: typeof fetch) => ({ fetch: implementation });

describe("installFetchInstrumentation", () => {
  it("records successful responses with query strings and fragments removed", async () => {
    const response = { status: 204 } as Response;
    const original = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
    const host = makeFetch(original);
    const events: InstrumentedRequestEvent[] = [];
    const stop = installFetchInstrumentation({ onRequest: (event) => events.push(event) }, host);

    const result = await host.fetch("https://api.example.test/users?token=private#section");

    expect(result).toBe(response);
    expect(original).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      transport: "fetch",
      method: "GET",
      url: "https://api.example.test/users",
      outcome: "success",
      status: 204
    });
    stop();
    expect(host.fetch).toBe(original);
  });

  it("redacts secret-bearing path segments before retaining request URLs", async () => {
    const original = vi.fn().mockResolvedValue({ status: 200 } as Response) as unknown as typeof fetch;
    const host = makeFetch(original);
    const events: InstrumentedRequestEvent[] = [];
    const stop = installFetchInstrumentation({ onRequest: (event) => events.push(event) }, host);

    await host.fetch("https://api.example.test/session/private-id/reset/one-time-token?still=private");

    expect(events[0]?.url).toBe("https://api.example.test/session/[redacted]/reset/[redacted]");
    stop();
  });

  it("ignores non-HTTP URL payloads instead of treating local responses as network activity", async () => {
    const original = vi.fn().mockResolvedValue({ status: 200 } as Response) as unknown as typeof fetch;
    const host = makeFetch(original);
    const events: InstrumentedRequestEvent[] = [];
    const stop = installFetchInstrumentation({ onRequest: (event) => events.push(event) }, host);

    await host.fetch("data:text/plain,private-payload");

    expect(events).toHaveLength(0);
    stop();
  });

  it("records HTTP errors without treating them as transport failures", async () => {
    const original = vi.fn().mockResolvedValue({ status: 503 } as Response) as unknown as typeof fetch;
    const host = makeFetch(original);
    const events: InstrumentedRequestEvent[] = [];
    const stop = installFetchInstrumentation({ onRequest: (event) => events.push(event) }, host);

    await host.fetch("/health");

    expect(events[0]).toMatchObject({ outcome: "http-error", status: 503 });
    stop();
  });

  it("classifies redirects and other non-2xx HTTP responses separately", async () => {
    const original = vi.fn().mockResolvedValue({ status: 302 } as Response) as unknown as typeof fetch;
    const host = makeFetch(original);
    const events: InstrumentedRequestEvent[] = [];
    const stop = installFetchInstrumentation({ onRequest: (event) => events.push(event) }, host);

    await host.fetch("/redirect");

    expect(events[0]).toMatchObject({ outcome: "http-error", status: 302 });
    stop();
  });

  it("records transport failures and rethrows the original error", async () => {
    const failure = new TypeError("Failed to fetch");
    const original = vi.fn().mockRejectedValue(failure) as unknown as typeof fetch;
    const host = makeFetch(original);
    const events: InstrumentedRequestEvent[] = [];
    const stop = installFetchInstrumentation({ onRequest: (event) => events.push(event) }, host);

    await expect(host.fetch("/api/data")).rejects.toBe(failure);
    expect(events[0]).toMatchObject({ outcome: "network-error", status: null });
    stop();
  });

  it("classifies AbortError and TimeoutError separately", async () => {
    const events: InstrumentedRequestEvent[] = [];
    const errors = [
      Object.assign(new Error("cancelled"), { name: "AbortError" }),
      Object.assign(new Error("timed out"), { name: "TimeoutError" })
    ];
    const original = vi.fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1]) as unknown as typeof fetch;
    const host = makeFetch(original);
    const stop = installFetchInstrumentation({ onRequest: (event) => events.push(event) }, host);

    await expect(host.fetch("/one")).rejects.toBe(errors[0]);
    await expect(host.fetch("/two")).rejects.toBe(errors[1]);

    expect(events.map((event) => event.outcome)).toEqual(["aborted", "timeout"]);
    stop();
  });

  it("supports ignore rules and does not let observer errors affect requests", async () => {
    const original = vi.fn().mockResolvedValue({ status: 200 } as Response) as unknown as typeof fetch;
    const host = makeFetch(original);
    const onRequest = vi.fn(() => { throw new Error("observer failed"); });
    const stop = installFetchInstrumentation({
      onRequest,
      shouldInstrument: (url) => !url.includes("/ignored")
    }, host);

    await host.fetch("/ignored");
    expect(onRequest).not.toHaveBeenCalled();
    await expect(host.fetch("/observed")).resolves.toMatchObject({ status: 200 });
    expect(onRequest).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not overwrite a later third-party fetch wrapper during cleanup", () => {
    const original = vi.fn() as unknown as typeof fetch;
    const host = makeFetch(original);
    const stop = installFetchInstrumentation({ onRequest: () => undefined }, host);
    const thirdPartyWrapper = vi.fn() as unknown as typeof fetch;
    host.fetch = thirdPartyWrapper;

    stop();

    expect(host.fetch).toBe(thirdPartyWrapper);
  });
});

class FakeXhr extends EventTarget {
  status = 200;
  open(_method: string, _url: string | URL): void {}
  send(_body?: Document | XMLHttpRequestBodyInit | null): void {}
  complete(status: number): void {
    this.status = status;
    this.dispatchEvent(new Event("loadend"));
  }
  fail(kind: "error" | "timeout" | "abort"): void {
    this.dispatchEvent(new Event(kind));
    this.dispatchEvent(new Event("loadend"));
  }
}

class ReopeningFakeXhr extends FakeXhr {
  private pending = false;
  open(method: string, url: string | URL): void {
    if (this.pending) {
      this.dispatchEvent(new Event("abort"));
      this.dispatchEvent(new Event("loadend"));
      this.pending = false;
    }
    super.open(method, url);
  }
  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.pending = true;
    super.send(body);
  }
  complete(status: number): void {
    this.pending = false;
    super.complete(status);
  }
}

describe("installXhrInstrumentation", () => {
  it("records HTTP responses and restores the original prototype methods", () => {
    const originalOpen = FakeXhr.prototype.open;
    const originalSend = FakeXhr.prototype.send;
    const events: InstrumentedRequestEvent[] = [];
    const stop = installXhrInstrumentation(
      { onRequest: (event) => events.push(event) },
      FakeXhr as unknown as typeof XMLHttpRequest
    );
    const xhr = new FakeXhr();

    xhr.open("POST", "https://api.example.test/items?session=private");
    xhr.send();
    xhr.complete(422);

    expect(events[0]).toMatchObject({
      transport: "xhr",
      method: "POST",
      url: "https://api.example.test/items",
      outcome: "http-error",
      status: 422
    });

    stop();
    expect(FakeXhr.prototype.open).toBe(originalOpen);
    expect(FakeXhr.prototype.send).toBe(originalSend);
  });

  it.each([
    ["error", "network-error"],
    ["timeout", "timeout"],
    ["abort", "aborted"]
  ] as const)("classifies XHR %s events", (kind, outcome) => {
    const events: InstrumentedRequestEvent[] = [];
    const stop = installXhrInstrumentation(
      { onRequest: (event) => events.push(event) },
      FakeXhr as unknown as typeof XMLHttpRequest
    );
    const xhr = new FakeXhr();

    xhr.open("GET", "/api/data");
    xhr.send();
    xhr.fail(kind);

    expect(events[0]?.outcome).toBe(outcome);
    stop();
  });

  it("keeps metadata correct when open aborts an earlier in-flight request", () => {
    const events: InstrumentedRequestEvent[] = [];
    const stop = installXhrInstrumentation(
      { onRequest: (event) => events.push(event) },
      ReopeningFakeXhr as unknown as typeof XMLHttpRequest
    );
    const xhr = new ReopeningFakeXhr();

    xhr.open("GET", "/first");
    xhr.send();
    xhr.open("POST", "/second");
    xhr.send();
    xhr.complete(201);

    expect(events.map((event) => [event.url, event.outcome])).toEqual([
      ["http://localhost:3000/first", "aborted"],
      ["http://localhost:3000/second", "success"]
    ]);
    stop();
  });

  it("classifies non-2xx XHR responses as HTTP errors", () => {
    const events: InstrumentedRequestEvent[] = [];
    const stop = installXhrInstrumentation(
      { onRequest: (event) => events.push(event) },
      FakeXhr as unknown as typeof XMLHttpRequest
    );
    const xhr = new FakeXhr();

    xhr.open("GET", "/redirect");
    xhr.send();
    xhr.complete(302);

    expect(events[0]).toMatchObject({ outcome: "http-error", status: 302 });
    stop();
  });

  it("removes listeners for in-flight requests when instrumentation stops", () => {
    const onRequest = vi.fn();
    const stop = installXhrInstrumentation(
      { onRequest },
      FakeXhr as unknown as typeof XMLHttpRequest
    );
    const xhr = new FakeXhr();

    xhr.open("GET", "/pending");
    xhr.send();
    stop();
    xhr.complete(200);

    expect(onRequest).not.toHaveBeenCalled();
  });
});

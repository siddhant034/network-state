import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { runReachabilityProbe } from "./adapters/reachability-probe";

vi.mock("./adapters/reachability-probe", () => ({
  runReachabilityProbe: vi.fn()
}));

const mockedProbe = vi.mocked(runReachabilityProbe);

const reachableResult = {
  status: "reachable" as const,
  timestamp: Date.now(),
  durationMs: 42,
  httpStatus: 204,
  detail: "The endpoint responded successfully with HTTP 204."
};

describe("Network State dashboard reachability controls", () => {
  beforeEach(() => {
    mockedProbe.mockResolvedValue(reachableResult);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });


  it("exports a diagnostics snapshot without persisting it in the app", async () => {
    const createObjectURL = vi.fn(() => "blob:diagnostics");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Export diagnostics snapshot" }));

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagnostics");
    expect(screen.getByRole("button", { name: "Export diagnostics snapshot" })).toBeInTheDocument();
  });

  it("keeps page request instrumentation opt-in and exposes a clear toggle", async () => {
    render(<App />);

    const enable = screen.getByRole("button", { name: "Enable monitoring" });
    expect(enable).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(enable);
    expect(screen.getByRole("button", { name: "Stop monitoring" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Query strings, fragments, headers, and bodies are never recorded/)).toBeInTheDocument();
  });

  it("runs an initial probe and displays its measured result", async () => {
    render(<App />);

    expect(await screen.findByText("Reachable")).toBeInTheDocument();
    expect(mockedProbe).toHaveBeenCalledWith(import.meta.env.BASE_URL, expect.objectContaining({ timeoutMs: 5_000, signal: expect.any(AbortSignal) }));
    expect(screen.getAllByText("42 ms").length).toBeGreaterThanOrEqual(2);
  });

  it("applies a custom endpoint and probes it", async () => {
    render(<App />);
    await screen.findByText("Reachable");

    const endpoint = "https://api.example.test/health";
    fireEvent.change(screen.getByRole("textbox", { name: "Reachability endpoint URL" }), {
      target: { value: endpoint }
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(mockedProbe).toHaveBeenCalledWith(endpoint, expect.objectContaining({ timeoutMs: 5_000, signal: expect.any(AbortSignal) }));
    });
  });

  it("does not retain a configured endpoint URL in the activity stream", async () => {
    mockedProbe.mockResolvedValueOnce(reachableResult).mockResolvedValue({
      status: "network-error",
      timestamp: 1_800_000_000_001,
      durationMs: 12,
      httpStatus: null,
      detail: "No HTTP response was received. Check the endpoint, DNS, TLS, and CORS configuration."
    });
    render(<App />);
    await screen.findByText("Reachable");

    const endpoint = "https://api.example.test/health?token=private-value";
    fireEvent.change(screen.getByRole("textbox", { name: "Reachability endpoint URL" }), {
      target: { value: endpoint }
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await screen.findByText("No response");
    expect(screen.queryByText(/private-value/)).not.toBeInTheDocument();
    expect(screen.getByText(/Configured reachability endpoint/)).toBeInTheDocument();
  });

  it("shows response-time analytics from reachability probes", async () => {
    render(<App />);

    await screen.findByText("Reachable");
    expect(screen.getByRole("heading", { name: "Latency history" })).toBeInTheDocument();
    expect(screen.getByText("Median")).toBeInTheDocument();
    expect(screen.getAllByText("42 ms").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("img", { name: /Latency history chart with 1 response sample/ })).toBeInTheDocument();
    const reliabilityPanel = screen.getByRole("region", { name: "Availability & recovery" });
    expect(within(reliabilityPanel).getAllByText("100.0%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("region", { name: "Correlated incident timeline" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Network testing lab" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Probes" }));
    expect(screen.getByRole("button", { name: "Probes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets the user trigger an immediate probe", async () => {
    render(<App />);
    await screen.findByText("Reachable");
    mockedProbe.mockClear();
    await waitFor(() => expect(screen.getByRole("button", { name: "Probe now" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Probe now" }));

    await waitFor(() => expect(mockedProbe).toHaveBeenCalledTimes(1));
  });
});

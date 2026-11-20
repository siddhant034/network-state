import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { runReachabilityProbe } from "./adapters/reachability-probe";

vi.mock("./adapters/reachability-probe", () => ({
  runReachabilityProbe: vi.fn()
}));

const mockedProbe = vi.mocked(runReachabilityProbe);

const reachableResult = {
  status: "reachable" as const,
  timestamp: 1_800_000_000_000,
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

  it("runs an initial probe and displays its measured result", async () => {
    render(<App />);

    expect(await screen.findByText("Reachable")).toBeInTheDocument();
    expect(mockedProbe).toHaveBeenCalledWith("/", { timeoutMs: 5_000 });
    expect(screen.getByText("42 ms")).toBeInTheDocument();
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
      expect(mockedProbe).toHaveBeenCalledWith(endpoint, { timeoutMs: 5_000 });
    });
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

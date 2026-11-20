import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NetworkTestLab } from "./NetworkTestLab";
import { runNetworkLab, type NetworkLabResult } from "../adapters/network-test-lab";

vi.mock("../adapters/network-test-lab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adapters/network-test-lab")>();
  return { ...actual, runNetworkLab: vi.fn() };
});

const mockedRun = vi.mocked(runNetworkLab);

const sampleResult: NetworkLabResult = {
  id: "endpoint-1-1",
  endpointLabel: "api.example.test",
  sequence: 1,
  status: "http-error",
  httpStatus: 503,
  durationMs: 84,
  timestamp: 1_800_000_000_000,
  attempts: 1,
  simulatedLatencyMs: 0,
  simulatedFailure: false,
  detail: "The endpoint responded with HTTP 503."
};

describe("NetworkTestLab", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("runs the configured endpoint workload and renders a safe result summary", async () => {
    mockedRun.mockImplementation(async (_endpoints, _options, onResult) => {
      onResult?.(sampleResult);
      return [sampleResult];
    });
    render(<NetworkTestLab />);

    fireEvent.change(screen.getByRole("textbox", { name: "Test endpoints" }), {
      target: { value: "https://api.example.test/health?token=private-value" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    expect(await screen.findByText("HTTP 503")).toBeInTheDocument();
    expect(screen.getByText("api.example.test")).toBeInTheDocument();
    expect(screen.queryByText(/private-value/)).not.toBeInTheDocument();
    expect(screen.getByText("84 ms")).toBeInTheDocument();
    expect(screen.getByText("Run complete.")).toBeInTheDocument();
    expect(mockedRun).toHaveBeenCalledWith(
      [expect.objectContaining({ label: "api.example.test" })],
      expect.objectContaining({ requestsPerEndpoint: 3, concurrency: 2, timeoutMs: 5_000 }),
      expect.any(Function)
    );
  });

  it("prevents a run when endpoint input contains credentials", async () => {
    render(<NetworkTestLab />);
    fireEvent.change(screen.getByRole("textbox", { name: "Test endpoints" }), {
      target: { value: "https://user:secret@example.test/health" }
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/without embedded credentials/);
    expect(screen.getByRole("button", { name: "Run test" })).toBeDisabled();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("aborts the active run when the user cancels it", async () => {
    let capturedSignal: AbortSignal | undefined;
    let finishRun: (() => void) | undefined;
    mockedRun.mockImplementation((_endpoints, options) => new Promise((resolve) => {
      capturedSignal = options?.signal;
      finishRun = () => resolve([]);
    }));
    render(<NetworkTestLab />);

    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await screen.findByRole("button", { name: "Cancel run" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));

    expect(capturedSignal?.aborted).toBe(true);
    finishRun?.();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Run cancelled/));
  });
});

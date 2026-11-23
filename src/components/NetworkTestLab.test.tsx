import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  simulationApplied: false,
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
    expect(within(screen.getByRole("table")).queryByText(/private-value/)).not.toBeInTheDocument();
    expect(screen.getByText("84 ms")).toBeInTheDocument();
    expect(await screen.findByText("Run complete.")).toBeInTheDocument();
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

  it("saves a named config locally and loads its endpoint and workload for replay", async () => {
    mockedRun.mockResolvedValueOnce([]);
    render(<NetworkTestLab />);

    fireEvent.change(screen.getByRole("textbox", { name: "Config name" }), {
      target: { value: "Office checks" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Test endpoints" }), {
      target: { value: "https://api.example.test/health?region=office" }
    });
    fireEvent.change(screen.getByLabelText("Requests / endpoint"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Concurrency"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/saved in this browser/);
    expect(screen.getByRole("option", { name: "Office checks" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Test endpoints" }), {
      target: { value: "https://other.example.test/" }
    });
    fireEvent.change(screen.getByLabelText("Requests / endpoint"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Saved configs"), { target: { value: screen.getByRole("option", { name: "Office checks" }).getAttribute("value") } });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));

    expect(screen.getByRole("textbox", { name: "Test endpoints" })).toHaveValue("https://api.example.test/health?region=office");
    expect(screen.getByLabelText("Requests / endpoint")).toHaveValue("5");
    expect(screen.getByLabelText("Concurrency")).toHaveValue("4");

    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await waitFor(() => expect(mockedRun).toHaveBeenCalledWith(
      [expect.objectContaining({ label: "api.example.test", url: "https://api.example.test/health?region=office" })],
      expect.objectContaining({ requestsPerEndpoint: 5, concurrency: 4 }),
      expect.any(Function)
    ));
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

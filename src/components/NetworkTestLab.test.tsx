import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NetworkTestLab } from "./NetworkTestLab";
import { NETWORK_LAB_CONFIG_STORAGE_KEY } from "../adapters/network-lab-configs";
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
    window.localStorage.clear();
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

  it("publishes completed lab results to the parent diagnostics session", async () => {
    const onResultsChange = vi.fn();
    mockedRun.mockImplementation(async (_endpoints, _options, onResult) => {
      onResult?.(sampleResult);
      return [sampleResult];
    });
    render(<NetworkTestLab onResultsChange={onResultsChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await screen.findByText("HTTP 503");
    await waitFor(() => expect(onResultsChange).toHaveBeenLastCalledWith([sampleResult]));
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


  it("saves named configurations locally, redacts query data, and reloads them", async () => {
    const firstRender = render(<NetworkTestLab />);
    fireEvent.change(screen.getByRole("textbox", { name: "Configuration name" }), {
      target: { value: "API smoke test" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Test endpoints" }), {
      target: { value: "https://api.example.test/health?token=private-value#section" }
    });
    fireEvent.change(screen.getByLabelText("Concurrency"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Query strings and fragments were removed/i);
    expect(screen.getByRole("textbox", { name: "Test endpoints" })).toHaveValue("https://api.example.test/health");
    const stored = window.localStorage.getItem("network-state:network-lab-configs:v1") ?? "";
    expect(stored).toContain("API smoke test");
    expect(stored).not.toContain("private-value");

    fireEvent.click(screen.getByRole("button", { name: "New configuration" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Configuration name" }), {
      target: { value: "Staging API" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByRole("status");
    const storedConfigs = JSON.parse(window.localStorage.getItem("network-state:network-lab-configs:v1") ?? "[]") as Array<{ name: string }>;
    expect(storedConfigs).toHaveLength(2);

    firstRender.unmount();
    render(<NetworkTestLab />);
    const saved = JSON.parse(window.localStorage.getItem("network-state:network-lab-configs:v1") ?? "[]") as Array<{ id: string; name: string }>;
    const originalConfig = saved.find((config) => config.name === "API smoke test");
    expect(originalConfig).toBeDefined();
    fireEvent.change(screen.getByRole("combobox", { name: "Saved configurations" }), {
      target: { value: originalConfig?.id }
    });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));

    expect(screen.getByRole("textbox", { name: "Test endpoints" })).toHaveValue("https://api.example.test/health");
    expect(screen.getByLabelText("Concurrency")).toHaveValue("4");
    expect(await screen.findByRole("status")).toHaveTextContent(/Loaded/);
  });

  it("refreshes saved configs when another same-origin tab updates or clears storage", async () => {
    render(<NetworkTestLab />);
    fireEvent.change(screen.getByRole("textbox", { name: "Configuration name" }), {
      target: { value: "Shared config" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByRole("status");

    const raw = window.localStorage.getItem(NETWORK_LAB_CONFIG_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!) as Array<{ id: string; name: string; updatedAt: number }>;
    stored[0].name = "Updated in another tab";
    stored[0].updatedAt += 1;
    const updatedValue = JSON.stringify(stored);
    window.localStorage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, updatedValue);
    window.dispatchEvent(new StorageEvent("storage", {
      key: NETWORK_LAB_CONFIG_STORAGE_KEY,
      newValue: updatedValue,
      storageArea: window.localStorage
    }));

    expect(await screen.findByRole("option", { name: "Updated in another tab" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/updated in another tab/i));

    window.localStorage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, "[]");
    window.dispatchEvent(new StorageEvent("storage", {
      key: NETWORK_LAB_CONFIG_STORAGE_KEY,
      newValue: "[]",
      storageArea: window.localStorage
    }));
    await waitFor(() => expect(screen.queryByRole("option", { name: "Updated in another tab" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Saved configurations" })).toBeDisabled());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/updated in another tab/i));

    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", {
      key: null,
      newValue: null,
      storageArea: window.localStorage
    }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/cleared in another tab/i));
  });

  it("preserves the last valid config list when another tab writes malformed storage", async () => {
    render(<NetworkTestLab />);
    fireEvent.change(screen.getByRole("textbox", { name: "Configuration name" }), {
      target: { value: "Last valid config" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByRole("status");

    const select = screen.getByRole("combobox", { name: "Saved configurations" });
    expect(screen.getByRole("option", { name: "Last valid config" })).toBeInTheDocument();

    window.localStorage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, "{broken");
    window.dispatchEvent(new StorageEvent("storage", {
      key: NETWORK_LAB_CONFIG_STORAGE_KEY,
      newValue: "{broken",
      storageArea: window.localStorage
    }));

    expect(screen.getByRole("option", { name: "Last valid config" })).toBeInTheDocument();
    expect(select).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/changed to invalid data in another tab/i));
    expect(screen.queryByText("{broken")).not.toBeInTheDocument();
  });

  it("deletes a saved configuration from local storage", async () => {
    render(<NetworkTestLab />);
    fireEvent.change(screen.getByRole("textbox", { name: "Configuration name" }), {
      target: { value: "Temporary config" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("group", { name: "Delete saved config?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete saved config" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/deleted from this device/));
    expect(window.localStorage.getItem("network-state:network-lab-configs:v1")).toBe("[]");
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NetworkTestLab } from "./NetworkTestLab";
import { runNetworkLab, type NetworkLabResult } from "../adapters/network-test-lab";
import { NETWORK_LAB_CONFIG_STORAGE_KEY } from "../adapters/network-lab-configs";

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

  it("requires confirmation before deleting one saved config and recovers from storage failure", async () => {
    render(<NetworkTestLab />);
    fireEvent.change(screen.getByRole("textbox", { name: "Config name" }), {
      target: { value: "Delete only after review" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("status");

    const readSaved = () => {
      const raw = window.localStorage.getItem(NETWORK_LAB_CONFIG_STORAGE_KEY);
      return raw ? JSON.parse(raw) as { configs: Array<{ name: string }> } : { configs: [] };
    };
    expect(readSaved().configs.map((config) => config.name)).toEqual(["Delete only after review"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("group", { name: "Delete saved config?" })).toBeInTheDocument();
    expect(readSaved().configs).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Delete saved config?" })).not.toBeInTheDocument();
    expect(readSaved().configs).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Delete saved config?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    expect(readSaved().configs).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete saved config" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not update local storage/);
    expect(screen.getByRole("group", { name: "Delete saved config?" })).toBeInTheDocument();
    expect(readSaved().configs).toHaveLength(1);
    setItem.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "Delete saved config" }));
    expect(readSaved().configs).toHaveLength(0);
    expect(await screen.findByRole("status")).toHaveTextContent(/Saved config deleted/);
  });

  it("requires confirmation before clearing saved configs and supports cancelling", async () => {
    render(<NetworkTestLab />);
    fireEvent.change(screen.getByRole("textbox", { name: "Config name" }), {
      target: { value: "Keep until confirmed" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("status");

    const readSaved = () => {
      const raw = window.localStorage.getItem(NETWORK_LAB_CONFIG_STORAGE_KEY);
      return raw ? JSON.parse(raw) as { configs: unknown[] } : { configs: [] };
    };
    expect(readSaved().configs).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByRole("group", { name: "Clear all saved configs?" })).toBeInTheDocument();
    expect(readSaved().configs).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Clear all saved configs?" })).not.toBeInTheDocument();
    expect(readSaved().configs).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Clear all" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Clear all saved configs?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toHaveFocus();
    expect(readSaved().configs).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete all saved configs" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not clear local storage/);
    expect(screen.getByRole("group", { name: "Clear all saved configs?" })).toBeInTheDocument();
    expect(readSaved().configs).toHaveLength(1);
    setItem.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "Delete all saved configs" }));
    expect(readSaved().configs).toHaveLength(0);
    expect(await screen.findByRole("status")).toHaveTextContent(/All saved configs cleared/);
  });

  it("refreshes saved configs when another tab updates or clears local storage", async () => {
    render(<NetworkTestLab />);
    fireEvent.change(screen.getByRole("textbox", { name: "Config name" }), {
      target: { value: "Shared config" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("status");

    const raw = window.localStorage.getItem(NETWORK_LAB_CONFIG_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!) as { schemaVersion: number; configs: Array<{ id: string; name: string; updatedAt: number }> };
    stored.configs[0].name = "Updated in another tab";
    stored.configs[0].updatedAt += 1;
    const updatedValue = JSON.stringify(stored);
    window.localStorage.setItem(NETWORK_LAB_CONFIG_STORAGE_KEY, updatedValue);
    window.dispatchEvent(new StorageEvent("storage", {
      key: NETWORK_LAB_CONFIG_STORAGE_KEY,
      newValue: updatedValue,
      storageArea: window.localStorage
    }));

    expect(await screen.findByRole("option", { name: "Updated in another tab" })).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(/updated in another tab/);

    window.localStorage.removeItem(NETWORK_LAB_CONFIG_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", {
      key: NETWORK_LAB_CONFIG_STORAGE_KEY,
      newValue: null,
      storageArea: window.localStorage
    }));

    await waitFor(() => expect(screen.getByLabelText("Saved configs")).toBeDisabled());
    expect(screen.queryByRole("option", { name: "Updated in another tab" })).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(/cleared in another tab/);
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

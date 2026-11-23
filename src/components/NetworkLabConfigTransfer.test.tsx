import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { saveNetworkLabConfig } from "../adapters/network-lab-configs";
import { createNetworkLabConfigExport } from "../adapters/network-lab-config-transfer";
import { NetworkLabConfigTransfer } from "./NetworkLabConfigTransfer";

const config = saveNetworkLabConfig([], {
  id: "portable-one",
  name: "Office",
  endpoints: ["https://api.example.test/health?region=office"],
  options: {
    requestsPerEndpoint: 3,
    concurrency: 2,
    timeoutMs: 5_000,
    retries: 1,
    simulatedLatencyMs: 0,
    simulatedFailureRate: 0
  }
}, 100)[0];

describe("NetworkLabConfigTransfer", () => {
  it("validates an imported file and passes configs to the parent without running them", async () => {
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);
    const file = new File([createNetworkLabConfigExport([config], 200)], "lab-configs.json", {
      type: "application/json"
    });

    fireEvent.change(screen.getByLabelText("Import saved configs"), { target: { files: [file] } });

    expect(await screen.findByRole("status")).toHaveTextContent(/nothing was run/);
    expect(onImport).toHaveBeenCalledWith([config]);
  });

  it("reports invalid files without invoking the import callback", async () => {
    const onImport = vi.fn();
    render(<NetworkLabConfigTransfer configs={[]} onImport={onImport} />);
    const file = new File(["not json"], "bad.json", { type: "application/json" });

    fireEvent.change(screen.getByLabelText("Import saved configs"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/valid JSON/);
    expect(onImport).not.toHaveBeenCalled();
  });
});

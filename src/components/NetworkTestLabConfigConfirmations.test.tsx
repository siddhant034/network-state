import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NETWORK_LAB_CONFIG_STORAGE_KEY } from "../adapters/network-lab-configs";
import { NetworkTestLab } from "./NetworkTestLab";

function readSaved(): unknown[] {
  const raw = window.localStorage.getItem(NETWORK_LAB_CONFIG_STORAGE_KEY);
  return raw ? JSON.parse(raw) as unknown[] : [];
}

function saveConfig(name: string, endpoint = "https://api.example.test/health"): void {
  fireEvent.change(screen.getByLabelText("Test endpoints"), { target: { value: endpoint } });
  fireEvent.change(screen.getByLabelText("Configuration name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
}

describe("saved-config destructive confirmations", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("requires keyboard-safe confirmation before deleting one saved config", async () => {
    render(<NetworkTestLab />);
    saveConfig("Office config");
    expect(readSaved()).toHaveLength(1);

    const deleteTrigger = screen.getByRole("button", { name: "Delete", exact: true });
    fireEvent.click(deleteTrigger);
    const confirmation = screen.getByRole("group", { name: "Delete saved config?" });
    expect(confirmation).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Delete saved config?" })).not.toBeInTheDocument();
    expect(deleteTrigger).toHaveFocus();
    expect(readSaved()).toHaveLength(1);

    fireEvent.click(deleteTrigger);
    fireEvent.click(screen.getByRole("button", { name: "Delete saved config", exact: true }));
    expect(await screen.findByRole("status")).toHaveTextContent(/deleted from this device/i);
    expect(readSaved()).toHaveLength(0);
    expect(screen.getByLabelText("Saved configurations")).toHaveFocus();
  });

  it("requires keyboard-safe confirmation before clearing all saved configs", async () => {
    render(<NetworkTestLab />);
    saveConfig("Office config");
    fireEvent.click(screen.getByRole("button", { name: "New configuration" }));
    saveConfig("Remote config");
    expect(readSaved()).toHaveLength(2);

    const clearTrigger = screen.getByRole("button", { name: "Clear all", exact: true });
    fireEvent.click(clearTrigger);
    const confirmation = screen.getByRole("group", { name: "Clear all saved configs?" });
    expect(confirmation).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Clear all saved configs?" })).not.toBeInTheDocument();
    expect(clearTrigger).toHaveFocus();
    expect(readSaved()).toHaveLength(2);

    fireEvent.click(clearTrigger);
    fireEvent.click(screen.getByRole("button", { name: "Delete all saved configs", exact: true }));
    expect(await screen.findByRole("status")).toHaveTextContent(/cleared from this device/i);
    expect(readSaved()).toHaveLength(0);
    expect(screen.getByLabelText("Saved configurations")).toHaveFocus();
    expect(screen.getByLabelText("Configuration name")).toHaveValue("Remote config");
    expect(screen.getByLabelText("Test endpoints")).toHaveValue("https://api.example.test/health");
  });
});

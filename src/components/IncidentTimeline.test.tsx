import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IncidentTimeline } from "./IncidentTimeline";
import type { ReliabilityObservation } from "../analytics/reliability";

afterEach(() => cleanup());

const now = Date.now();
const observations: ReliabilityObservation[] = [
  { timestamp: now - 5_000, source: "probe", outcome: "network-error" },
  { timestamp: now - 4_000, source: "fetch", outcome: "timeout" },
  { timestamp: now - 2_000, source: "probe", outcome: "success" }
];

describe("IncidentTimeline", () => {
  it("shows correlated incidents and their expandable event sequence", () => {
    render(<IncidentTimeline observations={observations} events={[]} window="2h" />);

    const panel = screen.getByRole("region", { name: "Correlated incident timeline" });
    expect(within(panel).getByText("Correlated network failures")).toBeInTheDocument();
    expect(within(panel).getByText("Ongoing", { selector: "span.incident-status" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByText("Inspect incident timeline"));
    expect(within(panel).getByText("No HTTP response")).toBeInTheDocument();
    expect(within(panel).getByText("Request timed out")).toBeInTheDocument();
  });

  it("filters incidents by source and status", () => {
    render(<IncidentTimeline observations={observations} events={[]} window="2h" />);
    const panel = screen.getByRole("region", { name: "Correlated incident timeline" });

    fireEvent.change(within(panel).getByLabelText("Incident source filter"), { target: { value: "fetch" } });
    expect(within(panel).getByText("Correlated network failures")).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText("Incident status filter"), { target: { value: "recovered" } });
    expect(within(panel).getByText("No matching investigation results")).toBeInTheDocument();
  });

  it("searches signal details and shows standalone configuration signals", () => {
    render(<IncidentTimeline observations={[
      { timestamp: now - 1_000, source: "probe", outcome: "invalid-endpoint" },
      { timestamp: now - 500, source: "fetch", outcome: "aborted" }
    ]} events={[]} window="5m" />);
    const panel = screen.getByRole("region", { name: "Correlated incident timeline" });

    expect(within(panel).getByText("Other signals")).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Search incidents and signals"), { target: { value: "credentials" } });
    expect(within(panel).getByText("Invalid reachability endpoint")).toBeInTheDocument();
    expect(within(panel).queryByText("Request aborted")).not.toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReliabilityPanel } from "./ReliabilityPanel";
import type { ReliabilityObservation } from "../analytics/reliability";

const observations: ReliabilityObservation[] = [
  { timestamp: 1_000, source: "probe", outcome: "success" },
  { timestamp: 2_000, source: "probe", outcome: "network-error" },
  { timestamp: 3_000, source: "probe", outcome: "success" },
  { timestamp: 3_500, source: "fetch", outcome: "http-error" },
  { timestamp: 4_000, source: "fetch", outcome: "success" }
];

describe("ReliabilityPanel", () => {
  it("shows availability, application success, and recovered outages", () => {
    render(<ReliabilityPanel observations={observations} window="2h" />);

    const panel = screen.getByRole("region", { name: "Availability & recovery" });
    expect(within(panel).getByText("HTTP availability")).toBeInTheDocument();
    expect(within(panel).getByText("Median recovery")).toBeInTheDocument();
    expect(within(panel).getByText("50.0%")).toBeInTheDocument();
    expect(within(panel).getByText("Reachability probes")).toBeInTheDocument();
    expect(within(panel).getByText("Fetch requests")).toBeInTheDocument();
    expect(within(panel).getByText(/HTTP 4xx\/5xx responses count as available but not successful/)).toBeInTheDocument();
  });

  it("explains the empty state with em-dash metrics when there are no observations", () => {
    render(<ReliabilityPanel observations={[]} window="30m" />);

    const panel = screen.getByRole("region", { name: "Availability & recovery" });
    expect(within(panel).getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(within(panel).getByText("Same 30m window as latency history")).toBeInTheDocument();
  });

  it("shows a currently unresolved outage", () => {
    render(<ReliabilityPanel observations={[
      { timestamp: 1_000, source: "xhr", outcome: "timeout" }
    ]} window="2h" />);

    expect(screen.getByRole("status")).toHaveTextContent(/currently have an unresolved transport outage/);
  });
});

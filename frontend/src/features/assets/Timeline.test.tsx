import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timeline, type AssetEvent } from "./Timeline";

function ev(overrides: Partial<AssetEvent>): AssetEvent {
  return {
    id: 1,
    event_type: "MOVED",
    event_date: "2026-01-01T00:00:00Z",
    status_after: "ALLOTTED",
    remarks: null,
    reference_no: null,
    label: "",
    ...overrides,
  };
}

describe("Timeline", () => {
  it("renders the server-built custody label instead of the raw event type", () => {
    render(
      <Timeline
        events={[
          ev({ id: 1, event_type: "PROCURED", status_after: "IN_STOCK", label: "Procured into IT Stock-HO" }),
          ev({ id: 2, event_type: "MOVED", status_after: "ALLOTTED", label: "Allotted to Ankur Pahwa" }),
        ]}
      />,
    );

    expect(screen.getByText("Procured into IT Stock-HO")).toBeInTheDocument();
    expect(screen.getByText("Allotted to Ankur Pahwa")).toBeInTheDocument();
    expect(screen.queryByText("MOVED")).not.toBeInTheDocument();
    expect(screen.queryByText("PROCURED")).not.toBeInTheDocument();
  });

  it("falls back to a readable event type if a label is missing", () => {
    render(<Timeline events={[ev({ id: 3, event_type: "SENT_FOR_REPAIR", status_after: "UNDER_REPAIR", label: "" })]} />);
    expect(screen.getByText("Sent for repair")).toBeInTheDocument();
  });

  it("shows the status after each event in plain words, never the raw code", () => {
    render(
      <Timeline
        events={[
          ev({ id: 1, event_type: "PROCURED", status_after: "IN_STOCK", label: "Received into HO Stock" }),
          ev({ id: 2, event_type: "SENT_FOR_REPAIR", status_after: "UNDER_REPAIR", label: "" }),
          ev({ id: 3, event_type: "RECEIVED_FROM_REPAIR", status_after: "ALLOTTED", label: "" }),
        ]}
      />,
    );
    expect(screen.getByText("In Stock")).toBeInTheDocument();
    expect(screen.getByText("Under Repair")).toBeInTheDocument();
    expect(screen.getByText("With Employee / Store")).toBeInTheDocument();
    expect(screen.getByText("Back from repair")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/IN_STOCK|UNDER_REPAIR|ALLOTTED|Allotted\b/);
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders every real asset status as readable text, not color alone", () => {
    const statuses = ["IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST"];
    for (const status of statuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status.replace(/_/g, " "))).toBeInTheDocument();
      unmount();
    }
  });

  it("gives an active-use status a different tone class than a terminal status", () => {
    const { container: allotted } = render(<StatusBadge status="ALLOTTED" />);
    const { container: disposed } = render(<StatusBadge status="DISPOSED" />);
    expect(allotted.firstChild).toHaveClass("bg-success-soft");
    expect(disposed.firstChild).toHaveClass("bg-secondary");
  });

  it("falls back to the neutral tone for an unrecognized status instead of throwing", () => {
    render(<StatusBadge status="SOME_FUTURE_STATUS" />);
    expect(screen.getByText("SOME FUTURE STATUS")).toBeInTheDocument();
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";
import { ASSET_STATUSES, statusLabel } from "@/lib/labels";

const RAW_ENUM = /\b(IN_STOCK|IN STOCK|ALLOTTED|INSTALLED|UNDER_REPAIR|UNDER REPAIR|DISPOSED|SOLD|SCRAPPED|LOST)\b/;

describe("StatusBadge", () => {
  it("renders every real asset status as a plain word, never the raw code", () => {
    for (const status of ASSET_STATUSES) {
      for (const compact of [false, true]) {
        const { container, unmount } = render(<StatusBadge status={status} compact={compact} />);
        expect(screen.getByText(statusLabel(status))).toBeInTheDocument();
        expect(container.textContent ?? "").not.toMatch(RAW_ENUM);
        unmount();
      }
    }
  });

  it("uses the plain words agreed with the owner", () => {
    const words = ASSET_STATUSES.map((s) => statusLabel(s));
    expect(words).toEqual([
      "In Stock", "With Employee / Store", "Installed", "Under Repair", "Lost", "Sold", "Scrapped", "Disposed",
    ]);
  });

  it("says With Employee or With Store when the holder type is known", () => {
    const { rerender } = render(<StatusBadge status="ALLOTTED" holderType="EMPLOYEE" />);
    expect(screen.getByText("With Employee")).toBeInTheDocument();
    rerender(<StatusBadge status="ALLOTTED" holderType="STORE" />);
    expect(screen.getByText("With Store")).toBeInTheDocument();
    rerender(<StatusBadge status="ALLOTTED" holderType={null} />);
    expect(screen.getByText("With Employee / Store")).toBeInTheDocument();
  });

  it("gives an active-use status a different tone class than a terminal status", () => {
    const { container: allotted } = render(<StatusBadge status="ALLOTTED" />);
    const { container: disposed } = render(<StatusBadge status="DISPOSED" />);
    expect(allotted.firstChild).toHaveClass("bg-success-soft");
    expect(disposed.firstChild).toHaveClass("bg-secondary");
  });

  it("falls back to the neutral tone and a sentence-case word for an unrecognized status", () => {
    render(<StatusBadge status="SOME_FUTURE_STATUS" />);
    expect(screen.getByText("Some future status")).toBeInTheDocument();
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title, description and an action", () => {
    render(<EmptyState title="No assets found" description="Try a different filter." action={<button>Clear filters</button>} />);
    expect(screen.getByText("No assets found")).toBeInTheDocument();
    expect(screen.getByText("Try a different filter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("renders with just a title", () => {
    render(<EmptyState title="Nothing expiring soon." />);
    expect(screen.getByText("Nothing expiring soon.")).toBeInTheDocument();
  });
});

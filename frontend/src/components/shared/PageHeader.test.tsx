import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the title, description, actions and filter slot together", () => {
    render(
      <PageHeader title="Asset Register" description="Search and filter." actions={<button>Add Asset</button>}>
        <div>filter row</div>
      </PageHeader>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Asset Register" })).toBeInTheDocument();
    expect(screen.getByText("Search and filter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Asset" })).toBeInTheDocument();
    expect(screen.getByText("filter row")).toBeInTheDocument();
  });

  it("renders without optional description/actions/children", () => {
    render(<PageHeader title="Dashboard" />);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
  });
});

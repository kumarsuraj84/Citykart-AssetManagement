import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable, type DataTableColumn } from "./DataTable";

interface Row {
  id: number;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name },
];

describe("DataTable", () => {
  it("renders columns and rows", () => {
    const rows: Row[] = [{ id: 1, name: "Laptop" }, { id: 2, name: "Monitor" }];
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} emptyState={<span>none</span>} />);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("Monitor")).toBeInTheDocument();
  });

  it("shows skeleton placeholders while loading, not the empty state", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} isLoading emptyState={<span>No rows</span>} />);
    expect(screen.queryByText("No rows")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows the caller's empty state when not loading and there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyState={<span>No rows</span>} />);
    expect(screen.getByText("No rows")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action instead of rows", () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[{ id: 1, name: "Laptop" }]}
        rowKey={(r) => r.id}
        isError
        errorMessage="Failed to load."
        onRetry={onRetry}
        emptyState={<span>No rows</span>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load.");
    expect(screen.queryByText("Laptop")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("fires onRowClick when a row is clicked", () => {
    const onRowClick = vi.fn();
    const rows: Row[] = [{ id: 1, name: "Laptop" }];
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} emptyState={<span />} />);
    fireEvent.click(screen.getByText("Laptop"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("does not fire onRowClick when the selection checkbox is toggled", () => {
    const onRowClick = vi.fn();
    const onToggle = vi.fn();
    const rows: Row[] = [{ id: 1, name: "Laptop" }];
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        emptyState={<span />}
        selection={{
          isSelected: () => false,
          onToggle,
          isAllSelected: false,
          onToggleAll: vi.fn(),
          rowAriaLabel: (r) => `Select ${r.name}`,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Laptop" }));
    expect(onToggle).toHaveBeenCalledWith(rows[0], true);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders the pagination summary and page label when provided", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyState={<span>none</span>}
        pagination={{
          summary: "Showing 1–50 of 120 assets",
          pageLabel: "Page 1 of 3",
          onPrevious: vi.fn(),
          onNext: vi.fn(),
          previousDisabled: true,
          nextDisabled: false,
        }}
      />,
    );
    expect(screen.getByText("Showing 1–50 of 120 assets")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });
});

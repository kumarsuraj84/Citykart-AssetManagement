import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SearchableSelect } from "./SearchableSelect";

const OPTIONS = [
  { value: "1", label: "CityKart HQ" },
  { value: "2", label: "CityKart Ventures" },
  { value: "3", label: "CityKart Retail" },
];

describe("SearchableSelect", () => {
  it("shows the placeholder when nothing is selected", () => {
    render(<SearchableSelect value={undefined} onValueChange={vi.fn()} options={OPTIONS} placeholder="Select company…" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Select company…");
  });

  it("shows the selected option's label, not its id", () => {
    render(<SearchableSelect value="2" onValueChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("CityKart Ventures");
  });

  it("opens on click and lists every option", async () => {
    render(<SearchableSelect value={undefined} onValueChange={vi.fn()} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByText("CityKart HQ")).toBeInTheDocument();
    expect(screen.getByText("CityKart Ventures")).toBeInTheDocument();
    expect(screen.getByText("CityKart Retail")).toBeInTheDocument();
  });

  it("filters the list as the user types", async () => {
    render(<SearchableSelect value={undefined} onValueChange={vi.fn()} options={OPTIONS} searchPlaceholder="Search…" />);
    fireEvent.click(screen.getByRole("combobox"));
    const search = await screen.findByPlaceholderText("Search…");
    fireEvent.change(search, { target: { value: "Ventures" } });

    await waitFor(() => expect(screen.queryByText("CityKart HQ")).not.toBeInTheDocument());
    expect(screen.getByText("CityKart Ventures")).toBeInTheDocument();
  });

  it("calls onValueChange with the option's id (not its label) and closes", async () => {
    const onValueChange = vi.fn();
    render(<SearchableSelect value={undefined} onValueChange={onValueChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("CityKart Retail"));

    expect(onValueChange).toHaveBeenCalledWith("3");
    await waitFor(() => expect(screen.queryByText("CityKart HQ")).not.toBeInTheDocument());
  });

  it("shows the empty-results message when nothing matches the search", async () => {
    render(<SearchableSelect value={undefined} onValueChange={vi.fn()} options={OPTIONS} emptyText="No results found." />);
    fireEvent.click(screen.getByRole("combobox"));
    const search = await screen.findByPlaceholderText("Search…");
    fireEvent.change(search, { target: { value: "nonexistent" } });

    expect(await screen.findByText("No results found.")).toBeInTheDocument();
  });
});

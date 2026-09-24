import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("is announced as an alert and shows a default message with no retry button by default", () => {
    render(<ErrorState />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a custom message and calls onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Failed to load the dashboard." onRetry={onRetry} />);
    expect(screen.getByText("Failed to load the dashboard.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

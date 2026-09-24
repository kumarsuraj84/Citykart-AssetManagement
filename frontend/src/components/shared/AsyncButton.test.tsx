import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AsyncButton } from "./AsyncButton";

describe("AsyncButton", () => {
  it("is clickable and shows its normal label when not pending", () => {
    render(<AsyncButton>Confirm</AsyncButton>);
    const button = screen.getByRole("button", { name: "Confirm" });
    expect(button).not.toBeDisabled();
  });

  it("disables itself and shows a pending label while pending", () => {
    render(
      <AsyncButton pending pendingLabel="Moving…">
        Confirm
      </AsyncButton>,
    );
    const button = screen.getByRole("button", { name: "Moving…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("stays disabled when disabled is passed even without pending", () => {
    render(<AsyncButton disabled>Confirm</AsyncButton>);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("associates its label with the control via htmlFor/id", () => {
    render(
      <FormField htmlFor="brand" label="Brand">
        <input id="brand" />
      </FormField>,
    );
    // getByLabelText only succeeds when the <label>'s htmlFor genuinely
    // matches the control's id -- this is the real accessibility linkage,
    // not just two strings that happen to look the same.
    expect(screen.getByLabelText("Brand")).toBeInTheDocument();
  });

  it("shows a required marker only when required is set", () => {
    const { rerender } = render(
      <FormField htmlFor="a" label="Serial Number" required>
        <input id="a" />
      </FormField>,
    );
    expect(screen.getByText("Serial Number")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();

    rerender(
      <FormField htmlFor="a" label="Serial Number">
        <input id="a" />
      </FormField>,
    );
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("shows helper text when there is no error, and the error instead when there is one", () => {
    const { rerender } = render(
      <FormField htmlFor="a" label="PI Number" helperText="Optional.">
        <input id="a" />
      </FormField>,
    );
    expect(screen.getByText("Optional.")).toBeInTheDocument();

    rerender(
      <FormField htmlFor="a" label="PI Number" helperText="Optional." errorText="PI Number is required.">
        <input id="a" />
      </FormField>,
    );
    expect(screen.getByText("PI Number is required.")).toBeInTheDocument();
    expect(screen.queryByText("Optional.")).not.toBeInTheDocument();
  });
});

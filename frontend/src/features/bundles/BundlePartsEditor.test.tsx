import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BundlePartsEditor } from "./BundlePartsEditor";
import { blankPart, type DraftPart } from "./bundle-parts";
import { MAX_BUNDLE_PARTS } from "../../lib/limits";

const parts = (n: number): DraftPart[] => Array.from({ length: n }, (_, i) => ({ ...blankPart(), name: `Part ${i + 1}` }));

describe("BundlePartsEditor: at most 50 parts (server limit)", () => {
  it("can add a part below the limit", () => {
    const onChange = vi.fn();
    render(<BundlePartsEditor parts={parts(2)} onChange={onChange} items={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add part" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(3);
    expect(screen.queryByText(/at most 50 parts/i)).not.toBeInTheDocument();
  });

  it("at 50 parts Add part is disabled and says why", () => {
    const onChange = vi.fn();
    render(<BundlePartsEditor parts={parts(MAX_BUNDLE_PARTS)} onChange={onChange} items={[]} />);
    const add = screen.getByRole("button", { name: "+ Add part" });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("A set can have at most 50 parts.")).toBeInTheDocument();
  });
});

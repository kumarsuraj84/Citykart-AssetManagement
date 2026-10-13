import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

describe("Dialog footer (S7 P2-4)", () => {
  it("sticks to the bottom of a long dialog's scroll area, so Save is always in view", () => {
    render(
      <Dialog open>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Employee</DialogTitle></DialogHeader>
          {Array.from({ length: 40 }, (_, i) => <p key={i}>Field {i}</p>)}
          <DialogFooter>
            <button type="button">Add Employee</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const footer = screen.getByRole("button", { name: "Add Employee" }).closest("[data-dialog-footer]") as HTMLElement;
    expect(footer).not.toBeNull();
    for (const c of ["sticky", "bottom-0", "bg-card", "-mx-5", "-mb-5"]) expect(footer.className).toContain(c);
  });
});

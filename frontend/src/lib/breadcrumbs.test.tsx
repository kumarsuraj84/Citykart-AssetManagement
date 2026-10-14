import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { addBreadcrumb, clearBreadcrumbs, getBreadcrumbs, installBreadcrumbListeners, shortcutLabel } from "./breadcrumbs";

let stop: () => void = () => {};
beforeEach(() => {
  clearBreadcrumbs();
  stop = installBreadcrumbListeners();
});
afterEach(() => stop());

const texts = () => getBreadcrumbs(50).map((c) => c.text);

describe("S8 breadcrumbs (in memory, never typed values)", () => {
  it("names a click by the button's / link's accessible name", () => {
    render(
      <div>
        <button type="button">Save</button>
        <button type="button" aria-label="Deactivate Vansh Enterprises"><svg /></button>
        <a href="/assets">Assets</a>
      </div>,
    );
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Vansh Enterprises" }));
    fireEvent.click(screen.getByText("Assets"));
    expect(texts()).toEqual(["Clicked “Save”", "Clicked “Deactivate Vansh Enterprises”", "Clicked “Assets”"]);
  });

  it("never records what is typed or clicked inside a field", () => {
    render(
      <form>
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" defaultValue="" />
        <label htmlFor="cb">Remember me</label>
        <input id="cb" type="checkbox" value="secret-value" />
        <textarea aria-label="Note" />
      </form>,
    );
    const pw = screen.getByLabelText("Password");
    fireEvent.click(pw);
    fireEvent.change(pw, { target: { value: "hunter2" } });
    fireEvent.keyDown(pw, { key: "h" });
    fireEvent.click(screen.getByLabelText("Note"));
    fireEvent.click(screen.getByLabelText("Remember me"));
    const all = JSON.stringify(getBreadcrumbs(50));
    expect(all).not.toContain("hunter2");
    expect(all).not.toContain("secret-value");
    expect(texts()).toEqual(["Clicked “Remember me”"]);
  });

  it("records keyboard shortcuts by their keys only", () => {
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "a" });
    expect(texts()).toEqual(["Pressed Ctrl+K", "Pressed Escape"]);
    expect(shortcutLabel({ key: "Control", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBeNull();
    expect(shortcutLabel({ key: "s", ctrlKey: false, metaKey: true, altKey: false, shiftKey: true })).toBe("Meta+Shift+S");
  });

  it("records a dialog opening with its title", async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Edit Vendor</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    await waitFor(() => expect(texts()).toContain("Opened the dialog “Edit Vendor”"));
  });

  it("keeps the last 50; a report takes the last 30", () => {
    for (let i = 0; i < 70; i++) addBreadcrumb("nav", `Opened /assets/${i}`);
    expect(getBreadcrumbs(100)).toHaveLength(50);
    const last30 = getBreadcrumbs();
    expect(last30).toHaveLength(30);
    expect(last30[29].text).toBe("Opened /assets/69");
  });
});

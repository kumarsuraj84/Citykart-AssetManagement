import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { useAuthStore } from "./auth-store";
import { readRemembered, remember, useRememberedDefault } from "./remembered-defaults";

afterEach(() => {
  vi.restoreAllMocks();            // first: the auth store writes to sessionStorage on logout
  useAuthStore.getState().logout();
});

describe("remember / readRemembered", () => {
  it("keeps the last choice per person, per company and per kind", () => {
    remember(5, 1, "cost_centre", 3);
    remember(5, 1, "stock_room", "4");
    remember(5, 2, "cost_centre", 30);
    remember(6, 1, "cost_centre", 99);
    expect(readRemembered(5, 1, "cost_centre")).toBe("3");
    expect(readRemembered(5, 1, "stock_room")).toBe("4");
    expect(readRemembered(5, 2, "cost_centre")).toBe("30");
    expect(readRemembered(6, 1, "cost_centre")).toBe("99");
    expect(readRemembered(6, 2, "stock_room")).toBeNull();
    remember(5, 1, "cost_centre", 8);                              // the last one wins
    expect(readRemembered(5, 1, "cost_centre")).toBe("8");
  });

  it("remembers nothing without a person, a company or a value", () => {
    remember(null, 1, "cost_centre", 3);
    remember(5, null, "cost_centre", 3);
    remember(5, 1, "cost_centre", "");
    expect(window.localStorage.length).toBe(0);
    expect(readRemembered(null, 1, "cost_centre")).toBeNull();
  });

  it("broken or blocked storage just means nothing is remembered", () => {
    window.localStorage.setItem("ckam:last-used:5:1", "{not json");
    expect(readRemembered(5, 1, "cost_centre")).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => remember(5, 1, "cost_centre", 3)).not.toThrow();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readRemembered(5, 1, "cost_centre")).toBeNull();
  });
});

function Picker({ ids, start = "", ready = true }: { ids: number[]; start?: string; ready?: boolean }) {
  const [value, setValue] = useState(start);
  useRememberedDefault({ kind: "stock_room", companyId: 1, value, setValue, validIds: ids, ready });
  return <p data-testid="value">{value || "(none)"}</p>;
}

describe("useRememberedDefault", () => {
  const signIn = () => useAuthStore.getState().setAuth({
    accessToken: "t", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 5,
  });

  it("chooses the remembered record once the list has loaded and it is still there", async () => {
    signIn();
    remember(5, 1, "stock_room", 4);
    render(<Picker ids={[4, 7]} />);
    await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("4"));
  });

  it("says nothing and chooses nothing when the remembered record no longer exists", async () => {
    signIn();
    remember(5, 1, "stock_room", 4);
    render(<Picker ids={[7]} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("value")).toHaveTextContent("(none)");
  });

  it("never replaces a choice already made (the ERP's own value, for example)", async () => {
    signIn();
    remember(5, 1, "stock_room", 4);
    render(<Picker ids={[4, 7]} start="7" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("value")).toHaveTextContent("7");
  });

  it("waits for the list", async () => {
    signIn();
    remember(5, 1, "stock_room", 4);
    render(<Picker ids={[]} ready={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("value")).toHaveTextContent("(none)");
  });
});

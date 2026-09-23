import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "./login";

describe("LoginForm", () => {
  it("submits company, user id and password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm companies={[{ id: 1, name: "Citykart Stores" }]} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/user id/i), { target: { value: "ADMIN1" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "Passw0rd!" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      companyId: 1, empCode: "ADMIN1", password: "Passw0rd!",
    }));
  });
});

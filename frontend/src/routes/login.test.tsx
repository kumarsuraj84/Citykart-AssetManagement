import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "./login";

describe("LoginForm", () => {
  it("submits user id and password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/user id/i), { target: { value: "ADMIN1" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "Passw0rd!" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      loginId: "ADMIN1", password: "Passw0rd!",
    }));
  });

  it("shows the backend's error message when login is rejected, without crashing", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Invalid credentials"));
    render(<LoginForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/user id/i), { target: { value: "ADMIN1" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
  });
});

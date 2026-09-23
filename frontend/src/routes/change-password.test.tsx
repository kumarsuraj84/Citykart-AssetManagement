import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangePasswordForm } from "./change-password";

function fill(old: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: old } });
  fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: /change password/i }));
}

describe("ChangePasswordForm", () => {
  it("submits old and new password when valid", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ChangePasswordForm required onSubmit={onSubmit} />);
    expect(screen.getByText(/temporary password/i)).toBeInTheDocument();

    fill("Temp-Passw0rd", "My-Own-Passw0rd", "My-Own-Passw0rd");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        oldPassword: "Temp-Passw0rd",
        newPassword: "My-Own-Passw0rd",
        confirmPassword: "My-Own-Passw0rd",
      }),
    );
  });

  it("rejects a mismatched confirmation, a short password, and reusing the old one", async () => {
    const onSubmit = vi.fn();
    render(<ChangePasswordForm required={false} onSubmit={onSubmit} />);

    fill("Temp-Passw0rd", "My-Own-Passw0rd", "Different-1");
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();

    fill("Temp-Passw0rd", "short", "short");
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();

    fill("Temp-Passw0rd", "Temp-Passw0rd", "Temp-Passw0rd");
    expect(await screen.findByText(/must be different/i)).toBeInTheDocument();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the server's error (e.g. wrong current password)", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Old password is incorrect"));
    render(<ChangePasswordForm required onSubmit={onSubmit} />);
    fill("wrong-one", "My-Own-Passw0rd", "My-Own-Passw0rd");
    expect(await screen.findByText("Old password is incorrect")).toBeInTheDocument();
  });
});

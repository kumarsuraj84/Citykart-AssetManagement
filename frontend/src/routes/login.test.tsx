import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ACCOUNT_LOCKED_MESSAGE,
  LoginForm,
  TOO_MANY_ATTEMPTS_MESSAGE,
  WRONG_CREDENTIALS_MESSAGE,
  loginErrorMessage,
  useLoginNotice,
} from "./login";
import { ApiError } from "@/lib/api-client";
import { LOGIN_NOTICE_KEY, SESSION_ENDED_NOTICE } from "@/lib/auth-fetch";

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

describe("LoginForm messages (security remediation)", () => {
  async function submitWith(error: unknown) {
    const onSubmit = vi.fn().mockRejectedValue(error);
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/user id/i), { target: { value: "SOMEONE" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    return screen.findByRole("alert");
  }

  it("429: shows the server's plain 'too many attempts' sentence", async () => {
    const detail = "Too many sign-in attempts. Wait a minute and try again.";
    const alert = await submitWith(new ApiError(detail, 429, { detail }));
    expect(alert).toHaveTextContent(detail);
    expect(alert).not.toHaveTextContent(/invalid credentials/i);
  });

  it("429 without a body still shows the plain sentence", async () => {
    expect(await submitWith(new ApiError("Request failed: 429", 429, null))).toHaveTextContent(TOO_MANY_ATTEMPTS_MESSAGE);
  });

  it("401 is the same generic sentence for an unknown user and a wrong password; 423 says locked", () => {
    expect(loginErrorMessage(new ApiError("Invalid credentials", 401, { detail: "Invalid credentials" }))).toBe(WRONG_CREDENTIALS_MESSAGE);
    expect(loginErrorMessage(new ApiError("anything", 401, null))).toBe(WRONG_CREDENTIALS_MESSAGE);
    expect(loginErrorMessage(new ApiError("Account locked, try again later", 423, null))).toBe(ACCOUNT_LOCKED_MESSAGE);
  });

  it("shows the 'session has ended' notice when given one, and replaces it by an error", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError("Invalid credentials", 401, null));
    render(<LoginForm onSubmit={onSubmit} notice={SESSION_ENDED_NOTICE} />);
    expect(screen.getByTestId("login-notice")).toHaveTextContent(SESSION_ENDED_NOTICE);
    fireEvent.change(screen.getByLabelText(/user id/i), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(screen.queryByTestId("login-notice")).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent(WRONG_CREDENTIALS_MESSAGE);
  });

  it("useLoginNotice reads the notice once and forgets it", async () => {
    window.sessionStorage.setItem(LOGIN_NOTICE_KEY, "expired");
    function Probe() {
      return <p>{useLoginNotice() ?? "none"}</p>;
    }
    render(<Probe />);
    expect(screen.getByText(SESSION_ENDED_NOTICE)).toBeInTheDocument();
    await waitFor(() => expect(window.sessionStorage.getItem(LOGIN_NOTICE_KEY)).toBeNull());
  });
});

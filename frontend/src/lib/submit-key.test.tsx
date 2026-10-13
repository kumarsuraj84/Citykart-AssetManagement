import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient } from "./api-client";
import { authFetch } from "./auth-fetch";
import { currentIdempotencyKey, runWithIdempotencyKey } from "./request-key";
import {
  SubmitKey, fingerprint, inFlightRetryDelays, newIdempotencyKey, sendKeyed, useKeyedMutation,
  IN_FLIGHT_DETAIL, KEY_REUSED_DETAIL,
} from "./submit-key";

vi.mock("./auth-fetch", () => ({ authFetch: vi.fn() }));

const ok = (body: unknown = { id: 1 }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const refused = (status: number, detail: string) =>
  new Response(JSON.stringify({ detail }), { status, headers: { "Content-Type": "application/json" } });
const headersOf = (call: unknown[]) => (call[1] as RequestInit).headers as Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  inFlightRetryDelays.ms = [1, 1];
});
afterEach(() => {
  inFlightRetryDelays.ms = [300, 600, 1000, 1500];
});

describe("Idempotency-Key plumbing (S7 P1-2)", () => {
  it("a request started inside runWithIdempotencyKey carries the header; others never do", async () => {
    (authFetch as any).mockImplementation(() => Promise.resolve(ok()));
    await runWithIdempotencyKey("k-1", () => apiClient.post("/x", { a: 1 }));
    await apiClient.post("/y", { a: 1 });
    await runWithIdempotencyKey("k-2", () => apiClient.get("/z"));
    const calls = (authFetch as any).mock.calls;
    expect(headersOf(calls[0])["Idempotency-Key"]).toBe("k-1");
    expect(headersOf(calls[0])["Content-Type"]).toBe("application/json");
    expect(headersOf(calls[1])["Idempotency-Key"]).toBeUndefined();
    expect(headersOf(calls[2])["Idempotency-Key"]).toBeUndefined();
    expect(currentIdempotencyKey()).toBeNull();
  });

  it("keys are UUIDs and differ", () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it("the key belongs to the payload: same payload keeps it, a changed payload or a renew replaces it", () => {
    const k = new SubmitKey();
    const first = k.for({ b: 2, a: 1 });
    expect(k.for({ a: 1, b: 2 })).toBe(first); // a retry of the same intent
    const second = k.for({ a: 1, b: 3 });
    expect(second).not.toBe(first); // corrected form = new intent
    k.renew();
    expect(k.for({ a: 1, b: 3 })).not.toBe(second); // after a success
    expect(fingerprint({ x: [1, { z: 1, y: undefined }] })).toBe('{"x":[1,{"z":1}]}');
  });

  it("409 'already being processed' -> asks again with the SAME key and returns the stored result", async () => {
    (authFetch as any)
      .mockResolvedValueOnce(refused(409, IN_FLIGHT_DETAIL))
      .mockResolvedValueOnce(ok({ id: 7 }));
    const k = new SubmitKey();
    const out = await sendKeyed(k, (keyed) => keyed({ a: 1 }, () => apiClient.post("/x", { a: 1 })));
    expect(out).toEqual({ id: 7 });
    const calls = (authFetch as any).mock.calls;
    expect(headersOf(calls[0])["Idempotency-Key"]).toBe(headersOf(calls[1])["Idempotency-Key"]);
  });

  it("422 'key already used for a different request' -> a new key, sent once more", async () => {
    (authFetch as any)
      .mockResolvedValueOnce(refused(422, KEY_REUSED_DETAIL))
      .mockResolvedValueOnce(ok({ id: 8 }));
    const k = new SubmitKey();
    const out = await sendKeyed(k, (keyed) => keyed({ a: 1 }, () => apiClient.post("/x", { a: 1 })));
    expect(out).toEqual({ id: 8 });
    const calls = (authFetch as any).mock.calls;
    expect(headersOf(calls[0])["Idempotency-Key"]).not.toBe(headersOf(calls[1])["Idempotency-Key"]);
  });
});

function Form({ onDone }: { onDone: (n: number) => void }) {
  const [n, setN] = useState(1);
  const m = useKeyedMutation({
    mutationFn: (_: void, keyed) => keyed({ n }, () => apiClient.post<{ id: number }>("/things", { n })),
    onSuccess: (row) => onDone(row.id),
  });
  return (
    <div>
      <input aria-label="n" value={n} onChange={(e) => setN(Number(e.target.value))} />
      <button type="button" onClick={() => m.mutate()} disabled={m.isPending}>Save</button>
      {m.isError && <p role="alert">{m.error?.message}</p>}
    </div>
  );
}

function mount(onDone = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><Form onDone={onDone} /></QueryClientProvider>);
  return onDone;
}

describe("useKeyedMutation (S7 P1-2)", () => {
  it("two activations in the same tick send ONE request", async () => {
    let release!: (r: Response) => void;
    (authFetch as any).mockImplementation(() => new Promise<Response>((r) => { release = r; }));
    const onDone = mount();
    const button = screen.getByRole("button", { name: "Save" });
    act(() => {
      button.click();
      button.click();
    });
    fireEvent.click(button);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(authFetch).toHaveBeenCalledTimes(1);
    await act(async () => release(ok({ id: 3 })));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(3));
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("after a success the next submit is a new intent (new key); after a failure the same data keeps its key, changed data gets a new one", async () => {
    (authFetch as any)
      .mockResolvedValueOnce(ok({ id: 1 }))
      .mockResolvedValueOnce(refused(422, "Quantity must be at least 1."))
      .mockResolvedValueOnce(refused(422, "Quantity must be at least 1."))
      .mockResolvedValueOnce(ok({ id: 2 }));
    const onDone = mount();
    const save = () => screen.getByRole("button", { name: "Save" });
    fireEvent.click(save());
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(1));
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Quantity must be at least 1.");
    await waitFor(() => expect(save()).not.toBeDisabled());
    fireEvent.click(save());
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(save()).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("n"), { target: { value: "5" } });
    fireEvent.click(save());
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(2));
    const keys = (authFetch as any).mock.calls.map((c: unknown[]) => headersOf(c)["Idempotency-Key"]);
    expect(keys[1]).not.toBe(keys[0]); // success -> new key
    expect(keys[2]).toBe(keys[1]); // same data retried
    expect(keys[3]).not.toBe(keys[2]); // corrected data
  });

  it("a request still running elsewhere is silent (no error shown)", async () => {
    (authFetch as any).mockImplementation(() => Promise.resolve(refused(409, IN_FLIGHT_DETAIL)));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

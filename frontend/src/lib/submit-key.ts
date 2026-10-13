/**
 * One submit = one intent = one `Idempotency-Key` (S7 fix P1-2).
 *
 * The UAT found that two activations of a Save button less than 20 ms apart
 * (a double-tap, a bouncing key, a client retry) both reached the server and
 * made two POs, two asset batches or two ledger events. Two layers stop that:
 *
 * 1. A synchronous in-flight guard: `mutate` is refused while the previous
 *    submit of the same form is still running. The flag is set before the
 *    first await, so two clicks in the same tick cannot both fire (the
 *    button's own `disabled` only arrives with the next render).
 * 2. An `Idempotency-Key` header on the request. The key belongs to the
 *    payload: a retry of the same payload after a failure keeps it; a changed
 *    payload (the person corrected the form) gets a new one; a success
 *    replaces it, so the next, deliberate submit is a new intent. A key is
 *    never sent with two different payloads.
 *
 * Server contract: a repeat of a finished request is answered with the
 * stored response (`Idempotency-Replay: true`); 409 "This request is already
 * being processed." = the same request is still running (we wait briefly and
 * ask again with the same key, which then returns the stored result; if it
 * is still running we stay silent -- the first submit shows its own result);
 * 422 "This request key was already used for a different request." = make a
 * new key and send once more.
 */
import { useCallback, useRef } from "react";
import { useMutation, type MutateOptions, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import { runWithIdempotencyKey } from "./request-key";

export const IN_FLIGHT_DETAIL = "This request is already being processed.";
export const KEY_REUSED_DETAIL = "This request key was already used for a different request.";

/** A fresh random key (UUID v4). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The same text for the same data whatever the key order (so `{a,b}` and `{b,a}` are one payload). */
export function fingerprint(payload: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(payload)) ?? "";
}

/** The key of one form: kept for the same payload, replaced for a new one or after a success. */
export class SubmitKey {
  private key = newIdempotencyKey();
  private fp: string | null = null;

  /** The key to send with this payload. */
  for(payload: unknown): string {
    const fp = fingerprint(payload);
    if (this.fp !== null && this.fp !== fp) this.key = newIdempotencyKey();
    this.fp = fp;
    return this.key;
  }

  /** Forget the intent: the next submit gets a new key (after a success, or when the server asks). */
  renew(): void {
    this.key = newIdempotencyKey();
    this.fp = null;
  }

  get current(): string {
    return this.key;
  }
}

/** One SubmitKey for the life of a form (created when the form mounts). */
export function useSubmitKey(): SubmitKey {
  const ref = useRef<SubmitKey | null>(null);
  if (ref.current === null) ref.current = new SubmitKey();
  return ref.current;
}

const statusOf = (e: unknown) => (e && typeof e === "object" ? (e as { status?: unknown }).status : undefined);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : "");

/** 409: the identical request is still being processed. */
export function isInFlightRefusal(e: unknown): boolean {
  return statusOf(e) === 409 && /already being processed/i.test(messageOf(e));
}

/** 422: this key was used for another payload -- a new key is needed. */
export function isKeyReusedRefusal(e: unknown): boolean {
  return statusOf(e) === 422 && /request key was already used/i.test(messageOf(e));
}

/** The same submit is still running elsewhere; nothing to show for this one. */
export class SubmitStillRunning extends Error {
  readonly silent = true;
  constructor() {
    super(IN_FLIGHT_DETAIL);
    this.name = "SubmitStillRunning";
  }
}

export function isSilentSubmitError(e: unknown): boolean {
  return e instanceof SubmitStillRunning;
}

/** Waits between asking again while the same request is still running (ms). Exported for tests. */
export const inFlightRetryDelays = { ms: [300, 600, 1000, 1500] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends `start()` (a request) with the key for `payload`. Used inside a
 * keyed mutation: `keyed(body, () => apiClient.post("/x", body))`.
 */
export type Keyed = <T>(payload: unknown, start: () => Promise<T>) => Promise<T>;

/**
 * Runs `attempt` with the key, handling the two idempotency answers:
 * in flight -> wait and ask again with the same key; key reused -> new key, once.
 */
export async function sendKeyed<T>(submitKey: SubmitKey, attempt: (keyed: Keyed) => Promise<T>): Promise<T> {
  const keyed: Keyed = (payload, start) => runWithIdempotencyKey(submitKey.for(payload), start);
  let renewed = false;
  let waits = 0;
  for (;;) {
    try {
      return await attempt(keyed);
    } catch (e) {
      if (isKeyReusedRefusal(e) && !renewed) {
        renewed = true;
        submitKey.renew();
        continue;
      }
      if (isInFlightRefusal(e)) {
        if (waits < inFlightRetryDelays.ms.length) {
          await sleep(inFlightRetryDelays.ms[waits++]);
          continue;
        }
        throw new SubmitStillRunning();
      }
      throw e;
    }
  }
}

type KeyedOptions<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, "mutationFn"> & {
  /** Build the request(s); wrap the submitting one in `keyed(payload, () => apiClient.post(...))`. */
  mutationFn: (vars: TVars, keyed: Keyed) => Promise<TData>;
};

/**
 * `useMutation` for a submit that must happen once: the returned `mutate`
 * ignores a second call while the first is running (synchronous guard), the
 * request carries the form's Idempotency-Key, and the key is replaced after a
 * success. A "still running" refusal never shows as an error.
 */
export function useKeyedMutation<TData = unknown, TVars = void>(
  options: KeyedOptions<TData, TVars>,
): UseMutationResult<TData, Error, TVars> {
  const submitKey = useSubmitKey();
  const busy = useRef(false);
  const { mutationFn, onSuccess, onError, onSettled, ...rest } = options;
  const m = useMutation<TData, Error, TVars>({
    ...rest,
    mutationFn: (vars) => sendKeyed(submitKey, (keyed) => mutationFn(vars, keyed)),
    onSuccess: (...args) => {
      submitKey.renew();
      return onSuccess?.(...args);
    },
    onError: (...args) => {
      if (isSilentSubmitError(args[0])) return;
      return onError?.(...args);
    },
    onSettled: (...args) => {
      busy.current = false;
      if (isSilentSubmitError(args[1])) return;
      return onSettled?.(...args);
    },
  });
  const baseMutate = m.mutate;
  const mutate = useCallback(
    (vars: TVars, opts?: MutateOptions<TData, Error, TVars>) => {
      if (busy.current) return;
      busy.current = true;
      const onCallError = opts?.onError;
      baseMutate(
        vars,
        onCallError
          ? { ...opts, onError: (...a: Parameters<typeof onCallError>) => (isSilentSubmitError(a[0]) ? undefined : onCallError(...a)) }
          : opts,
      );
    },
    [baseMutate],
  ) as unknown as typeof baseMutate;
  const silent = isSilentSubmitError(m.error);
  if (!silent) return { ...m, mutate } as UseMutationResult<TData, Error, TVars>;
  return { ...m, mutate, error: null, isError: false, status: "idle", isIdle: true } as unknown as UseMutationResult<TData, Error, TVars>;
}

/**
 * Only the synchronous guard, for a submit handler that does not go through a
 * mutation: `if (!guard.begin()) return; try { ... } finally { guard.end(); }`.
 */
export function useSubmitGuard(): { begin: () => boolean; end: () => void } {
  const busy = useRef(false);
  return useRef({
    begin: () => {
      if (busy.current) return false;
      busy.current = true;
      return true;
    },
    end: () => {
      busy.current = false;
    },
  }).current;
}

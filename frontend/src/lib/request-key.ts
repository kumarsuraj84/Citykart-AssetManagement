/**
 * The `Idempotency-Key` that the request being sent right now should carry
 * (S7 fix P1-2). Kept apart from api-client.ts on purpose: the screen tests
 * replace api-client with an automatic mock, and this tiny module must stay
 * real so a test can see which key a request was sent with.
 *
 * The key is "ambient" only for the synchronous moment a request is started:
 * `runWithIdempotencyKey(key, () => apiClient.post(...))` sets it, api-client
 * reads it before its first `await`, and it is cleared again straight away.
 * Nothing else ever sees it, so an unrelated request can never pick it up.
 */
let ambient: string | null = null;

export function runWithIdempotencyKey<T>(key: string, start: () => T): T {
  const previous = ambient;
  ambient = key;
  try {
    return start();
  } finally {
    ambient = previous;
  }
}

/** The key for the request being started at this very moment, or null. */
export function currentIdempotencyKey(): string | null {
  return ambient;
}

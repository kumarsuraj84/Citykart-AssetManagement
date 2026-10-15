import { QueryClient } from "@tanstack/react-query";

/**
 * The app's one query cache. A module of its own so signing out (lib/auth-fetch.ts) can empty it: otherwise
 * the next person to sign in on the same tab would briefly see -- or, if their own call is refused, keep
 * seeing -- what the previous person's screens loaded.
 */
export const queryClient = new QueryClient();

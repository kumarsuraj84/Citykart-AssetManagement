import { authFetch } from "./auth-fetch";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // FormData (multipart uploads, e.g. the Excel import screen) must be sent
  // as-is: JSON.stringify-ing it would produce "[object FormData]", and
  // setting Content-Type ourselves would drop the multipart boundary the
  // browser generates. Only set the JSON header/serialize for plain bodies.
  const isFormData = body instanceof FormData;
  // authFetch attaches the bearer token and handles 401 -> refresh -> retry once
  // -> otherwise redirect to /login (see lib/auth-fetch.ts).
  const res = await authFetch(path, {
    method,
    headers: isFormData ? {} : { "Content-Type": "application/json" },
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    const message = typeof detail.detail === "string" ? detail.detail : undefined;
    throw new Error(message ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

import { test, expect, type Page, type Request } from "@playwright/test";

/**
 * Security journeys (deterministic, no scanning): route guards by role, self-service isolation, open
 * redirect after sign-in, unsafe rendering of stored text, sign-in messages, and the end of a session.
 *
 * WHERE THIS RUNS -- the isolated security stack `ckam-sec`, NOT the UAT stack the other specs use: it signs
 * in as that stack's seeded personas (see the security fixture: SECHO head-office admin, SECFANIT Full Admin
 * Non-IT, SECOPIT operator IT, SECVIEW viewer, SECSELF self-service, SECOP2IT spare operator). It needs no
 * `docker compose exec`: everything it creates goes through the real API as SECHO.
 *
 *   E2E_BASE_URL=http://localhost:3411 E2E_SEC_PASSWORD=<the personas' shared test password> \
 *     npx playwright test e2e/security.spec.ts
 *
 * Optional: E2E_EXPECT_REMEDIATED_AUTH=1 makes the two checks that depend on the remediated backend mandatory
 * (sign-out revokes the access token; a burst of sign-ins is answered 429). Without it, each of those two is
 * decided by a runtime probe of the backend's actual answer and recorded as an annotation when the backend
 * does not do it yet.
 *
 * Creates (and deactivates afterwards): one vendor named with an HTML payload and one purchase order for it.
 * The sign-in burst runs LAST: when the backend rate-limits by address, sign-ins from this machine are
 * refused for about a minute afterwards.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3411";
const PASSWORD = process.env.E2E_SEC_PASSWORD ?? "";
const EXPECT_REMEDIATED = process.env.E2E_EXPECT_REMEDIATED_AUTH === "1";
const NO_ACCESS = "You don't have access to this area.";
const XSS = "<img src=x onerror=window.__xss=1>";

test.describe.configure({ mode: "serial" });
test.skip(!PASSWORD, "Set E2E_SEC_PASSWORD (the ckam-sec personas' shared test password) to run the security journeys.");

async function apiCall(method: string, path: string, token?: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function apiLogin(code: string): Promise<string> {
  const res = await apiCall("POST", "/api/auth/login", undefined, { login_id: code, password: PASSWORD });
  expect(res.status, `API sign-in as ${code}`).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function json<T>(res: Response): Promise<T> {
  expect(res.ok, `${res.url} -> ${res.status}`).toBeTruthy();
  return (await res.json()) as T;
}

async function fillLogin(page: Page, code: string, password: string) {
  await page.getByLabel("User ID", { exact: true }).fill(code);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

async function uiLogin(page: Page, code: string) {
  await page.goto("/login");
  await fillLogin(page, code, PASSWORD);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });
}

/** Every /api request the page makes from now on (path only). */
function recordApiCalls(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r: Request) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) seen.push(`${r.method()} ${u.pathname}`);
  });
  return seen;
}

interface AssetRow { id: number; asset_code: string; company_id: number; asset_domain: string; current_asset_user_id: number | null }

test.describe("route guards by role", () => {
  test("self-service: deep links to staff areas show the no-access page and fetch none of their data", async ({ page }) => {
    await uiLogin(page, "SECSELF");
    const deepLinks: [string, RegExp][] = [
      ["/settings", /^GET \/api\/(masters|admin|people|asset-users|erp)\//],
      ["/purchase-orders/new", /^(GET|POST) \/api\/(purchase-orders|masters\/vendors|items)/],
      ["/reports", /^GET \/api\/reports/],
      ["/settings/system/logs", /^GET \/api\/admin\/logs/],
    ];
    for (const [path, protectedApi] of deepLinks) {
      const calls = recordApiCalls(page);
      await page.goto(path);
      await expect(page.getByText(NO_ACCESS)).toBeVisible();
      await page.waitForTimeout(800);
      expect(calls.filter((c) => protectedApi.test(c)), `no protected data fetched for ${path}`).toEqual([]);
    }
  });

  test("viewer: no write actions on Assets, and no access to Purchase Orders", async ({ page }) => {
    await uiLogin(page, "SECVIEW");
    await page.goto("/assets");
    await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
    await expect(page.getByRole("link", { name: /CKSPL\// }).first()).toBeVisible();
    for (const name of ["Add Assets", /Serial Pending/, "Select all"]) {
      await expect(page.getByRole("main").getByRole("button", { name }).or(page.getByRole("main").getByRole("link", { name }))).toHaveCount(0);
    }
    await page.getByRole("link", { name: /CKSPL\// }).first().click();
    await expect(page.getByRole("heading", { name: "Identity" })).toBeVisible();
    for (const name of [/^Move/, /^Edit$/, /^Print Label$/, /^More actions$/, /^Upload$/]) {
      await expect(page.getByRole("main").getByRole("button", { name })).toHaveCount(0);
    }
    for (const path of ["/purchase-orders", "/purchase-orders/new", "/receive"]) {
      await page.goto(path);
      await expect(page.getByText(NO_ACCESS)).toBeVisible();
    }
  });

  test("operator IT cannot open Settings", async ({ page }) => {
    await uiLogin(page, "SECOPIT");
    for (const path of ["/settings", "/settings/vendors", "/settings/system/logs"]) {
      await page.goto(path);
      await expect(page.getByText(NO_ACCESS)).toBeVisible();
    }
  });

  test("Full Admin Non-IT: a deep link to an IT asset shows 'Asset not found.' and none of it", async ({ page }) => {
    const head = await apiLogin("SECHO");
    const { items } = await json<{ items: AssetRow[] }>(await apiCall("GET", "/api/assets?limit=200", head));
    const it = items.find((a) => a.asset_domain === "IT");
    expect(it, "an IT asset exists on this stack").toBeTruthy();
    await uiLogin(page, "SECFANIT");
    const calls: { path: string; status: number }[] = [];
    page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname === `/api/assets/${it!.id}`) calls.push({ path: u.pathname, status: r.status() }); });
    await page.goto(`/assets/${it!.id}`);
    await expect(page.getByText("Asset not found.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(it!.asset_code)).toHaveCount(0);
    expect(calls.every((c) => c.status !== 200)).toBeTruthy();
  });
});

test("self-service isolation: another person's asset by id shows no data", async ({ page }) => {
  const self = await apiLogin("SECSELF");
  const mine = new Set((await json<{ items: AssetRow[] }>(await apiCall("GET", "/api/assets?limit=200", self))).items.map((a) => a.id));
  const head = await apiLogin("SECHO");
  const all = (await json<{ items: AssetRow[] }>(await apiCall("GET", "/api/assets?limit=200", head))).items;
  const other = all.find((a) => !mine.has(a.id));
  expect(other, "an asset not held by SECSELF").toBeTruthy();
  expect((await apiCall("GET", `/api/assets/${other!.id}`, self)).status).not.toBe(200);

  await uiLogin(page, "SECSELF");
  await page.goto(`/assets/${other!.id}`);
  await expect(page.getByText("Asset not found.").or(page.getByText(NO_ACCESS))).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(other!.asset_code)).toHaveCount(0);
});

test.describe("open redirect after sign-in", () => {
  for (const next of ["//evil.test", "https://evil.test", "javascript:alert(1)", "/\t/evil.test", "/%2F%2Fevil.test"]) {
    test(`?next=${JSON.stringify(next)} never leaves the app`, async ({ page }) => {
      let dialog = false;
      page.on("dialog", async (d) => { dialog = true; await d.dismiss(); });
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await fillLogin(page, "SECOPIT", PASSWORD);
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });
      await page.waitForTimeout(800);
      expect(new URL(page.url()).origin).toBe(new URL(BASE).origin);
      expect(dialog).toBe(false);
    });
  }
});

test.describe("stored text is shown as text, never run", () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const vendorName = `SEC-E2E-${stamp} ${XSS}`;
  const poNumber = `SEC-E2E-PO-${stamp}`;
  let head = "";
  let vendorId = 0;
  let poId = 0;

  test.beforeAll(async () => {
    head = await apiLogin("SECHO");
    vendorId = (await json<{ id: number }>(await apiCall("POST", "/api/masters/vendors", head, { name: vendorName }))).id;
    const ccs = await json<{ id: number; company_id: number; is_active: boolean }[]>(await apiCall("GET", "/api/masters/cost-centers", head));
    const cc = ccs.find((c) => c.is_active)!;
    poId = (await json<{ id: number }>(await apiCall("POST", "/api/purchase-orders", head, {
      company_id: cc.company_id, po_number: poNumber, po_date: new Date().toISOString().slice(0, 10), vendor_id: vendorId, cost_center_id: cc.id,
    }))).id;
  });

  test.afterAll(async () => {
    // Soft removal only (nothing is ever hard-deleted): the PO is cancelled, the vendor deactivated.
    if (poId) await apiCall("DELETE", `/api/purchase-orders/${poId}`, head).catch(() => undefined);
    if (vendorId) await apiCall("DELETE", `/api/masters/vendors/${vendorId}`, head).catch(() => undefined);
  });

  async function expectInert(page: Page) {
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
  }

  test("vendor list, PO list, PO page and Logs", async ({ page }) => {
    await uiLogin(page, "SECHO");

    await page.goto("/settings/vendors");
    await expect(page.getByText(vendorName).first()).toBeVisible({ timeout: 15_000 });
    await expectInert(page);

    await page.goto("/purchase-orders");
    await expect(page.getByText(poNumber).first()).toBeVisible({ timeout: 15_000 });
    await expectInert(page);

    await page.goto(`/purchase-orders/${poId}`);
    await expect(page.getByText(vendorName).first()).toBeVisible({ timeout: 15_000 });
    await expectInert(page);

    await page.goto("/settings/system/logs");
    await expect(page.getByText(`SEC-E2E-${stamp}`).first()).toBeVisible({ timeout: 15_000 });
    await expectInert(page);
  });
});

/** The alert's sentence only -- without the per-request "Reference: <id> Copy" line under it. */
async function alertSentence(page: Page): Promise<string> {
  const alert = page.getByRole("alert").first();
  await expect(alert).toBeVisible();
  return alert.evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[data-reference-line]").forEach((n) => n.remove());
    return (copy.textContent ?? "").trim();
  });
}

test.describe("sign-in messages", () => {
  test("a wrong password and an unknown User ID get the same generic message", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, "SECOP2IT", "definitely-not-the-password");
    const wrong = await alertSentence(page);
    await page.goto("/login");
    await fillLogin(page, `NOSUCH-${Date.now()}`, "definitely-not-the-password");
    const unknown = await alertSentence(page);
    expect(wrong).toBe(unknown);
    expect(wrong).not.toMatch(/locked|not found|no such|does not exist/i);
    // Reset SECOP2IT's failed-attempt count (a successful sign-in clears it).
    await apiLogin("SECOP2IT");
  });
});

test("session end: Back shows no protected data and the token is gone from sessionStorage", async ({ page }, testInfo) => {
  await uiLogin(page, "SECVIEW");
  await page.goto("/assets");
  const firstCode = (await page.getByRole("link", { name: /CKSPL\// }).first().innerText()).trim();
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ckam-auth") ?? "null")?.state?.accessToken as string | null);
  expect(token).toBeTruthy();

  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForURL(/\/login/);
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ckam-auth") ?? "null")?.state?.accessToken ?? null);
  expect(stored).toBeNull();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => (localStorage.getItem(k) ?? "").includes(".ey")))).toEqual([]);

  await page.goBack();
  await page.waitForTimeout(1000);
  expect(new URL(page.url()).pathname).toMatch(/^\/login/);
  await expect(page.getByText(firstCode)).toHaveCount(0);

  // Capability probe: does the backend revoke the access token at sign-out (remediated) or not yet?
  const after = await apiCall("GET", "/api/auth/capabilities", token!);
  if (after.status === 200) {
    testInfo.annotations.push({ type: "capability", description: "backend does not revoke the access token at sign-out yet" });
    expect(EXPECT_REMEDIATED, "E2E_EXPECT_REMEDIATED_AUTH=1 but the old access token still works after sign-out").toBe(false);
  } else {
    expect(after.status).toBe(401);
  }
});

// LAST on purpose: with an address-based limit, sign-ins from this machine are refused for a minute after it.
test("a burst of sign-ins is answered with the plain 'too many attempts' message (when the backend limits)", async ({ page }, testInfo) => {
  const unknown = `NOSUCH-BURST-${Date.now()}`;
  let limited: Response | null = null;
  for (let i = 0; i < 30 && !limited; i++) {
    const res = await apiCall("POST", "/api/auth/login", undefined, { login_id: unknown, password: "x" });
    if (res.status === 429) limited = res;
  }
  if (!limited) {
    testInfo.annotations.push({ type: "capability", description: "backend does not rate-limit sign-in yet (no 429 in 30 attempts)" });
    expect(EXPECT_REMEDIATED, "E2E_EXPECT_REMEDIATED_AUTH=1 but no 429 after 30 failed sign-ins").toBe(false);
    return;
  }
  expect(limited.headers.get("retry-after")).toBeTruthy();
  await page.goto("/login");
  await fillLogin(page, unknown, "x");
  const alert = page.getByRole("alert").first();
  await expect(alert).toContainText(/too many/i);
  await expect(alert).not.toContainText(/invalid credentials/i);
});

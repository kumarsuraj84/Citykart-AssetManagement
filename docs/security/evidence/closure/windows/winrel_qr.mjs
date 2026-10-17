// Cold-load an Asset 360 link (what scanning a QR printed from the asset page opens) on the native Windows release.
import { createRequire } from "node:module";
const require = createRequire("D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/frontend/package.json");
const { chromium } = require("@playwright/test");
const BASE = "http://127.0.0.1:3613";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const external = [];
const csp = [];
page.on("request", (r) => { const u = new URL(r.url()); if (u.hostname !== "127.0.0.1") external.push(r.url()); });
page.on("console", (m) => { if (/Content Security Policy|CSP/i.test(m.text())) csp.push(m.text()); });
await page.goto(BASE + "/assets/1");                         // cold load, exactly like a scan
await page.waitForURL(/\/login\?next=/, { timeout: 15000 });
console.log("cold load of /assets/1 ->", page.url().replace(BASE, ""));
await page.getByPlaceholder("Employee Code or Email").fill("SECHO");
await page.getByLabel("Password", { exact: true }).fill("Sec#Test2026ok");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/\/assets\/1$/, { timeout: 20000 });
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);
const heading = (await page.locator("main").last().innerText()).slice(0, 160).replace(/\s+/g, " ");
console.log("after sign-in url:", page.url().replace(BASE, ""));
console.log("page text starts:", heading);
const font = await page.evaluate(() => document.fonts.check("14px Inter"));
console.log("Inter loaded:", font, "| non-local requests:", external.map((u) => u.slice(0, 30)).join(",") || "none", "| count:", external.length, "| CSP console messages:", csp.length);
// the same link opened inside the signed-in tab by typing the address (hard navigation)
await page.goto(BASE + "/assets/2");
await page.waitForTimeout(2500);
console.log("hard navigation to /assets/2 stays on:", page.url().replace(BASE, ""), "| text:", (await page.locator("main").last().innerText()).slice(0, 80).replace(/\s+/g, " "));
await b.close();

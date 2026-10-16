// Security AU-12 / AU-14 / AU-15 / N3 / N5 / FONTS (OBS-AU12-TEST): permanent static checks of the Docker web server
// config (frontend/nginx.conf) and of the build settings. No docker needed; the live behaviour is checked by
// scripts/check-nginx-live.mjs. If one of these fails, a hardening line was removed or weakened -- put it back
// rather than changing the test (see docs/security/CKAM_SECURITY_CLOSURE_REGISTER.md).
import { describe, expect, it } from "vitest";
import nginxConf from "../../nginx.conf?raw";
import viteConfig from "../../vite.config.ts?raw";
import indexHtml from "../../index.html?raw";

type Block = { head: string; body: string; children: Block[] };

/** Strips comments, then splits the config into nested `head { body }` blocks (enough for this one file). */
function parse(text: string): Block {
  const src = text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
  let i = 0;
  function readBlock(head: string): Block {
    const block: Block = { head: head.trim(), body: "", children: [] };
    let buf = "";
    let quote: string | null = null;
    while (i < src.length) {
      const c = src[i++];
      if (quote) {
        buf += c;
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        buf += c;
      } else if (c === "{") {
        const stmtStart = Math.max(buf.lastIndexOf(";"), buf.lastIndexOf("}")) + 1;
        const childHead = buf.slice(stmtStart);
        block.body += buf.slice(0, stmtStart);
        buf = "";
        block.children.push(readBlock(childHead));
        block.body += "}";
      } else if (c === "}") {
        block.body += buf;
        return block;
      } else {
        buf += c;
      }
    }
    block.body += buf;
    return block;
  }
  return readBlock("root");
}

/** The directives of one block (its own statements only, not its children's). */
function directives(block: Block): string[][] {
  // Split on `;` (and on the `}` left where a child block was) outside quotes -- the CSP value and the JSON
  // 413 body contain both characters inside their quotes.
  const statements: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (const c of block.body) {
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      buf += c;
    } else if (c === ";" || c === "}") {
      statements.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  statements.push(buf);
  return statements
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []);
}

const root = parse(nginxConf);
const server = root.children.find((b) => b.head === "server");
const locations = server?.children.filter((b) => b.head.startsWith("location")) ?? [];
const location = (head: string) => locations.find((b) => b.head.replace(/\s+/g, " ") === head);
const mapValue = (name: string) => {
  const block = root.children.find((b) => b.head === `map $host ${name}`);
  const def = block && directives(block).find((d) => d[0] === "default");
  return def ? def[1].replace(/^"|"$/g, "") : "";
};
const SECURITY_HEADERS = ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Content-Security-Policy", "Permissions-Policy"];
const addHeaders = (block: Block) => directives(block).filter((d) => d[0] === "add_header");

describe("nginx.conf hardening", () => {
  it("parses into one server block with locations", () => {
    expect(server).toBeDefined();
    expect(locations.length).toBeGreaterThanOrEqual(5);
  });

  it("hides the nginx version (AU-15)", () => {
    expect(directives(server!)).toContainEqual(["server_tokens", "off"]);
  });

  it("keeps a body-size limit and answers an oversized upload with the app's JSON sentence (AU-15)", () => {
    expect(directives(server!).some((d) => d[0] === "client_max_body_size")).toBe(true);
    const tooLarge = location("location @too_large");
    expect(tooLarge).toBeDefined();
    const ret = directives(tooLarge!).find((d) => d[0] === "return");
    expect(ret?.[1]).toBe("413");
    expect(ret?.slice(2).join(" ")).toMatch(/"detail"/);
    expect(directives(tooLarge!)).toContainEqual(["default_type", "application/json"]);
  });

  it("has a strict Content-Security-Policy without any Google host (AU-14, FONTS)", () => {
    const csp = mapValue("$ckam_csp");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).toContain("font-src 'self' data:;");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(csp).not.toMatch(/googleapis|gstatic|https?:/i);
    expect(nginxConf).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it("switches off camera, microphone and the rest (Permissions-Policy)", () => {
    expect(mapValue("$ckam_permissions_policy")).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });

  it("sends every security header, with `always`, from the server and from every location that sets headers", () => {
    const blocks = [server!, ...locations.filter((l) => addHeaders(l).length > 0)];
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      const names = addHeaders(block).map((d) => d[1]);
      for (const h of SECURITY_HEADERS) {
        expect(names.filter((n) => n === h), `${block.head}: ${h}`).toHaveLength(1);
      }
      for (const d of addHeaders(block)) expect(d[d.length - 1], `${block.head}: ${d.join(" ")}`).toBe("always");
    }
    // The CSP and Permissions-Policy always come from the one shared value.
    for (const block of blocks) {
      expect(addHeaders(block)).toContainEqual(["add_header", "Content-Security-Policy", "$ckam_csp", "always"]);
      expect(addHeaders(block)).toContainEqual(["add_header", "Permissions-Policy", "$ckam_permissions_policy", "always"]);
    }
  });

  it("never serves a source map (AU-12)", () => {
    const maps = location("location ~* \\.map$");
    expect(maps).toBeDefined();
    expect(directives(maps!)).toContainEqual(["return", "404"]);
  });

  it("answers a missing static file with 404, not the app shell (AU-12)", () => {
    const statics = locations.find((l) => /^location ~\*/.test(l.head) && /try_files/.test(l.body) && !/\\\.map\$/.test(l.head));
    expect(statics).toBeDefined();
    expect(directives(statics!)).toContainEqual(["try_files", "$uri", "=404"]);
    const pattern = new RegExp(statics!.head.replace(/^location ~\*\s+/, ""), "i");
    for (const p of ["/assets/index-abc.js", "/assets/x.mjs", "/assets/index-abc.css", "/assets/inter-latin.woff2", "/logo.png", "/favicon.webp"]) {
      expect(pattern.test(p), p).toBe(true);
    }
    for (const p of ["/assets/42", "/purchase-orders/7", "/settings/system/logs"]) expect(pattern.test(p), p).toBe(false);
    // Everything else falls back to the app shell, which is always revalidated.
    expect(directives(location("location /")!)).toContainEqual(["try_files", "$uri", "/index.html"]);
    expect(addHeaders(location("location = /index.html")!)).toContainEqual(["add_header", "Cache-Control", '"no-cache"', "always"]);
  });

  it("proxies /api/ with the real client address, overwritten and never appended (N3)", () => {
    const api = location("location ^~ /api/");
    expect(api).toBeDefined();
    const d = directives(api!);
    expect(d).toContainEqual(["proxy_set_header", "X-Forwarded-For", "$remote_addr"]);
    expect(d).toContainEqual(["proxy_set_header", "X-Real-IP", "$remote_addr"]);
    expect(d).toContainEqual(["proxy_set_header", "X-Forwarded-Proto", "$scheme"]);
    expect(d).toContainEqual(["proxy_set_header", "Host", "$host"]);
    // $proxy_add_x_forwarded_for would keep whatever the browser sent and let it pick its own address.
    expect(nginxConf).not.toMatch(/\$proxy_add_x_forwarded_for/);
    expect(d).toContainEqual(["error_page", "413", "=", "@too_large"]);
    expect(addHeaders(api!)).toContainEqual(["add_header", "Cache-Control", '"no-store"', "always"]);
  });

  it("drops the API's own copies of the headers nginx adds, so each appears once (N5)", () => {
    const hidden = directives(location("location ^~ /api/")!).filter((d) => d[0] === "proxy_hide_header").map((d) => d[1]);
    for (const h of [...SECURITY_HEADERS, "Cache-Control"]) expect(hidden, h).toContain(h);
  });
});

describe("build settings", () => {
  it("never writes source maps into the production bundle (AU-12)", () => {
    expect(viteConfig).toMatch(/sourcemap:\s*false/);
  });

  it("index.html loads nothing from another site (FONTS, AU-14)", () => {
    expect(indexHtml).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(indexHtml).not.toMatch(/<(?:script|link|img)\b[^>]*\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
  });
});

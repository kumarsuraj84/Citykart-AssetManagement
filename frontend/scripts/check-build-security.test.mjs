// Self-test of scripts/check-build-security.mjs (AU-12 / FONTS): it must pass a clean build and catch each
// problem it is meant to catch. Builds tiny fake dist folders in the OS temp folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkBuild } from "./check-build-security.mjs";

const made = [];
function fakeDist(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ckam-check-build-"));
  made.push(dir);
  const all = {
    "index.html": '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-a1.js"></script><link rel="stylesheet" href="/assets/index-b2.css"></head><body></body></html>',
    "assets/index-a1.js": 'const ns="http://www.w3.org/2000/svg";console.log(ns);',
    "assets/index-b2.css": '@font-face{font-family:Inter;src:url(/assets/inter-latin-wght-normal-x.woff2) format("woff2")}.i{background:url("data:image/svg+xml,%3csvg xmlns=%27http://www.w3.org/2000/svg%27/%3e")}',
    "assets/inter-latin-wght-normal-x.woff2": "wOF2",
    ...files,
  };
  for (const [name, content] of Object.entries(all)) {
    if (content === null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}
afterEach(() => {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
});

describe("check-build-security", () => {
  it("passes a clean self-hosted build", () => {
    expect(checkBuild(fakeDist({}))).toEqual([]);
  });

  it("refuses a folder without a build", () => {
    expect(checkBuild(fakeDist({ "index.html": null }))[0]).toMatch(/no build found/);
  });

  it("catches a source map file and a sourceMappingURL directive (AU-12)", () => {
    const problems = checkBuild(fakeDist({
      "assets/index-a1.js.map": "{}",
      "assets/index-a1.js": "console.log(1);\n//# sourceMappingURL=index-a1.js.map",
      "assets/index-b2.css": "a{}\n/*# sourceMappingURL=index-b2.css.map */",
    }));
    expect(problems).toContain("source map file in the build: assets/index-a1.js.map");
    expect(problems).toContain("sourceMappingURL directive in assets/index-a1.js");
    expect(problems).toContain("sourceMappingURL directive in assets/index-b2.css");
  });

  it("catches Google Fonts anywhere (FONTS)", () => {
    const problems = checkBuild(fakeDist({ "assets/index-a1.js": 'fetch("https://fonts.gstatic.com/x.woff2")' }));
    expect(problems).toContain("Google Fonts host referenced in assets/index-a1.js");
  });

  it("catches an external script, stylesheet, font or picture in index.html or a stylesheet", () => {
    const problems = checkBuild(fakeDist({
      "index.html": '<html><head><script src="https://cdn.example.com/x.js"></script><link rel="stylesheet" href="//cdn.example.com/y.css"><link rel="preload" as="font" href="http://cdn.example.com/f.woff2"></head><body><img src="https://cdn.example.com/p.png"></body></html>',
      "assets/index-b2.css": '@import url("https://cdn.example.com/z.css");@font-face{src:url(https://cdn.example.com/f.woff2)}',
    }));
    expect(problems).toEqual(expect.arrayContaining([
      "index.html loads an external resource: https://cdn.example.com/x.js",
      "index.html loads an external resource: //cdn.example.com/y.css",
      "index.html loads an external resource: http://cdn.example.com/f.woff2",
      "index.html loads an external resource: https://cdn.example.com/p.png",
      "stylesheet assets/index-b2.css @imports an external file: https://cdn.example.com/z.css",
      "stylesheet assets/index-b2.css loads an external url(): https://cdn.example.com/f.woff2",
    ]));
  });
});

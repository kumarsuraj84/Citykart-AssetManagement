import { describe, it, expect } from "vitest";

/*
 * S3b-1 guard: "+ New …" controls are decided by GET /auth/capabilities
 * (lib/capabilities.ts), never by the old owner-only gate, and the old
 * dead-end sentences do not come back.
 */
const sources = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/test-*.ts"], {
  query: "?raw", import: "default", eager: true,
}) as Record<string, string>;

describe("no owner-only gate for in-flow creation", () => {
  it("reads the source files", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(sources)).toContain("/src/lib/capabilities.ts");
  });

  it("useCanCreateMasters is gone everywhere", () => {
    const users = Object.entries(sources).filter(([, text]) => /useCanCreateMasters/.test(text)).map(([file]) => file);
    expect(users).toEqual([]);
  });

  it("no \"+ New …\" entry is decided by the head-office (Primary Owner) flag", () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      text.split("\n").forEach((line, i) => {
        if (/onCreateNew|onNewItem/.test(line) && /isPrimaryOwner|is_primary_owner|PrimaryOwner/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the quick-create dialogs read the capabilities, not the auth store", () => {
    const masters = sources["/src/components/quick-create/masters.tsx"];
    expect(masters).toMatch(/useCapabilities/);
    expect(masters).not.toMatch(/useAuthStore/);
  });

  it("the old dead-end sentences are gone", () => {
    const dead = [
      /Add one under Setup/i,
      /ask the Primary Owner/i,
      /An admin can add one under People/i,
      /under Settings › Organisation › Cost Centres/i,
      /No active cost centres are configured/i,
    ];
    const hits = Object.entries(sources).flatMap(([file, text]) => dead.filter((re) => re.test(text)).map((re) => `${file} ${re}`));
    expect(hits).toEqual([]);
  });
});

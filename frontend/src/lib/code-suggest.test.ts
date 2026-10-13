import { describe, it, expect } from "vitest";
import { suggestCode } from "./code-suggest";

describe("suggestCode", () => {
  it("uses one letter per word, keeping a word that is already an abbreviation", () => {
    expect(suggestCode("IT Fixed Assets")).toBe("ITFA");
    expect(suggestCode("Admin Fixed Assets")).toBe("AFA");
    expect(suggestCode("Network Switch")).toBe("NS");
    expect(suggestCode("CCTV camera 4K")).toBe("CCTVC4K");
  });

  it("uses the start of a single word, upper-case letters and digits only", () => {
    expect(suggestCode("Laptop")).toBe("LAPTOP");
    expect(suggestCode("Projectors")).toBe("PROJEC");
    expect(suggestCode("  fan ")).toBe("FAN");
    expect(suggestCode("UPS-2kVA")).toBe("UPS2");
  });

  it("adds a number when the code is already taken (any case)", () => {
    expect(suggestCode("Network Switch", ["ns"])).toBe("NS2");
    expect(suggestCode("Network Switch", ["NS", "NS2"])).toBe("NS3");
  });

  it("gives nothing for a blank name", () => {
    expect(suggestCode("")).toBe("");
    expect(suggestCode(" - ")).toBe("");
  });
});

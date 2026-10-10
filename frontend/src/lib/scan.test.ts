import { describe, it, expect } from "vitest";
import { assetScanQuery, isAssetLink } from "./scan";

describe("assetScanQuery", () => {
  it("searches a serial or asset code as text", () => {
    expect(assetScanQuery("SN-001")).toBe("q=SN-001&limit=5");
    expect(assetScanQuery(" FA/HO/IT/1 ", "&exact=true")).toBe("q=FA%2FHO%2FIT%2F1&limit=5&exact=true");
  });
  it("turns the label's QR link into a lookup of that one asset", () => {
    expect(assetScanQuery("http://10.0.1.98:3211/assets/123")).toBe("ids=123&limit=5");
    expect(assetScanQuery("https://ckam.example/assets/45?x=1")).toBe("ids=45&limit=5");
  });
  it("knows a link from a code", () => {
    expect(isAssetLink("http://10.0.1.98:3211/assets/123")).toBe(true);
    expect(isAssetLink("FA/HO01/IT/LAP/CK_1")).toBe(false);
    expect(isAssetLink("SN-assets-5")).toBe(false);
  });
});

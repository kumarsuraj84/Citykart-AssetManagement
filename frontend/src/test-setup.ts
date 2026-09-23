import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// This project's vitest config doesn't enable `globals: true`, so Testing
// Library's own auto-cleanup (which hooks a global `afterEach`) never
// registers. Without this, DOM from one test leaks into the next whenever a
// test file has more than one test. Register it explicitly.
afterEach(() => cleanup());

// jsdom doesn't implement these, but Radix UI's Select (used e.g. by
// HoldersScreen and MasterCrudScreen) calls them when opening/scrolling its
// popover-positioned listbox. Without these no-op polyfills, interacting
// with a Select in tests throws "not a function" errors.
if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture !== "function") {
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// This project's vitest config doesn't enable `globals: true`, so Testing
// Library's own auto-cleanup (which hooks a global `afterEach`) never
// registers. Without this, DOM from one test leaks into the next whenever a
// test file has more than one test. Register it explicitly.
afterEach(() => cleanup());

// jsdom doesn't implement these, but Radix UI's Select (used e.g. by
// AssetUsersScreen and MasterCrudScreen) calls them when opening/scrolling its
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

// jsdom doesn't implement ResizeObserver, but cmdk's Command (the shared
// SearchableSelect combobox) uses it internally to track its list size.
// Without this no-op polyfill, opening a SearchableSelect in tests throws
// "ResizeObserver is not defined".
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom doesn't implement matchMedia, but the shared Sidebar component's
// use-mobile hook (AppShell's nav) calls it to detect the mobile breakpoint.
// Without this, any test that renders AppShell throws "not a function".
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

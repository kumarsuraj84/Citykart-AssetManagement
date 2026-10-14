import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.tsx";
import { router } from "./router";
import { installErrorCapture } from "./lib/client-reports";
import { addBreadcrumb } from "./lib/breadcrumbs";

// S8: automatic problem reports (crashes, unhandled errors, 5xx / unanswered calls) and the breadcrumbs
// that go with them. Only here, in the real app -- unit tests render screens without it.
installErrorCapture();
router.subscribe("onResolved", ({ toLocation }) => {
  // The path only: search parameters can hold what a person typed.
  addBreadcrumb("nav", `Opened ${toLocation.pathname}`);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import type { ComponentType, ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { homePathFor, useAccess, type Area } from "@/lib/access";
import { useCapabilities } from "@/lib/capabilities";
import { canUseCatalogue } from "./AppNav";

/** Shown inside the app shell instead of a screen the person may not use. */
export function NoAccess() {
  const { role } = useAccess();
  const home = homePathFor(role);
  return (
    <section
      aria-labelledby="no-access-title"
      className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-md border bg-card p-6 text-center"
    >
      <Lock className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <h1 id="no-access-title" className="text-lg font-semibold">
        You don&apos;t have access to this area.
      </h1>
      <p className="text-sm text-muted-foreground">
        If you need it for your work, ask the head-office admin.
      </p>
      <Button asChild size="sm">
        <Link to={home}>{home === "/my-assets" ? "Go to My Assets" : "Go to Home"}</Link>
      </Button>
    </section>
  );
}

/**
 * Wraps a route's screen so it renders only for people who may use `area`;
 * everyone else gets <NoAccess /> straight away (never a flash of the screen,
 * since the check reads the session synchronously before the screen mounts,
 * so the screen's own data requests never fire either). UX only: the server
 * still checks every request.
 */
/**
 * S7 (final review): the Catalogue screens (Items, Asset Groups) -- the head-office admin always; a Full
 * Admin when the capabilities endpoint says they may manage Items or Asset Groups of a work area (the
 * screen then offers edit / deactivate only inside that area; the server checks every save). Anyone
 * else gets <NoAccess />. While the answer loads nothing of the screen is shown.
 */
export function guardedCatalogue<P extends object>(Screen: ComponentType<P>): (props: P) => ReactElement {
  function GuardedCatalogue(props: P): ReactElement {
    const { can } = useAccess();
    const { caps, settled } = useCapabilities();
    if (can("settings")) return <Screen {...props} />;
    if (!can("admin")) return <NoAccess />;
    if (!settled) return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
    return canUseCatalogue(caps) ? <Screen {...props} /> : <NoAccess />;
  }
  GuardedCatalogue.displayName = `GuardedCatalogue(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return GuardedCatalogue;
}

export function guarded<P extends object>(area: Area, Screen: ComponentType<P>): (props: P) => ReactElement {
  function Guarded(props: P): ReactElement {
    const { can } = useAccess();
    if (!can(area)) return <NoAccess />;
    return <Screen {...props} />;
  }
  Guarded.displayName = `Guarded(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Guarded;
}

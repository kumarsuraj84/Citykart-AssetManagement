import { z } from "zod";

/**
 * AU-14: the app runs under a Content-Security-Policy without 'unsafe-eval'. zod v4 otherwise probes
 * `new Function("")` when the first `z.object()` is built (to decide on its compiled fast path); the probe is
 * caught, but the browser still reports it as a CSP violation. `jitless` skips the probe and the compiled
 * path entirely -- validation results are identical, only the internal strategy differs.
 *
 * Must run before any module builds a schema: imported first in main.tsx, and by every module that
 * defines a schema at load time.
 */
z.config({ jitless: true });

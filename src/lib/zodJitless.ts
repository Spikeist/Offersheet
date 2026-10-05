/**
 * zod without eval in the browser (planner reply to Checkpoint 4c, Part B: browser fetching, track BF; the production
 * Content-Security-Policy has no 'unsafe-eval', next.config.ts). zod compiles a fast parser for each object schema with
 * `new Function`, and probes for it with a caught `new Function("")` that a strict policy still reports as a violation.
 * Both happen when an object schema is CONSTRUCTED, so this must run before any schema module's body: every module that
 * builds zod schemas and is reachable from the browser (src/adapters/espn/schema.ts, src/adapters/sleeper/schemas.ts)
 * imports it first, for its side effect. The server keeps zod's compiled parsers (they're faster), so this only acts
 * where there's a window; zodJitless.test.ts checks both, and that those modules import it.
 */
import { z } from "zod";

/** Whether this module turned zod's compiled parsers off (true in a browser page, false on the server and in tests). */
export const ZOD_JITLESS: boolean = typeof window !== "undefined";

if (ZOD_JITLESS) z.config({ jitless: true });

/**
 * What the browser loads to read a league itself (track BF; src/lib/leagueFetch.ts and what it imports) is browser-safe:
 * no node: modules and no server modules but the plain numbers of src/server/limits.ts, and every module there that builds
 * zod schemas turns zod's eval-compiled parsers off first (src/lib/zodJitless.ts: the production Content-Security-Policy has
 * no 'unsafe-eval', and zod probes for eval when an object schema is built). Read from the sources' static imports, as
 * the bundler follows them (type-only imports aside). No network.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

/** The browser path's entry points (src/lib/leagueFetch.ts, the read it loads on demand, and the client components that call it). */
const ENTRIES = ["lib/leagueFetch.ts", "lib/leagueRead.ts", "lib/browserHttp.ts", "adapters/upload.ts", "components/connect/EspnConnect.tsx", "components/connect/SleeperConnect.tsx", "components/import/ImportReport.tsx", "components/league/useLeagueInputs.ts"];
/** What the pages load first (static imports only): the read (zod, the adapters) must not be among it. */
const FIRST_LOAD = ["components/connect/ConnectFlow.tsx", "components/import/ImportReport.tsx", "components/league/useLeagueInputs.ts", "lib/leagueFetch.ts"];

/** A module's value imports (side-effect imports included; `import type` and all-type specifier lists left out), in order. */
function valueImports(source: string): string[] {
  const out: string[] = [];
  // A clause holds no quote or semicolon, so a side-effect import is never read as the start of the next statement.
  const statement = /^\s*(import|export)\s+(type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;
  for (const m of source.matchAll(statement)) {
    if (m[5]) {
      out.push(m[5]);
      continue;
    }
    if (m[2]) continue; // import type / export type
    const clause = (m[3] ?? "").trim();
    const braces = /^\{([\s\S]*)\}$/.exec(clause);
    if (braces) {
      const names = (braces[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length && names.every((n) => n.startsWith("type "))) continue;
    }
    out.push(m[4] as string);
  }
  return out;
}

/** A specifier as a file under src/, or null for a package (or node: module, returned as itself). */
function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  throw new Error(`can't resolve ${spec} from ${rel(from)}`);
}

/** Every module the entries reach by value imports, with the packages and node: modules each imports. */
function browserGraph(entries: readonly string[] = ENTRIES): Map<string, { imports: string[]; packages: string[] }> {
  const graph = new Map<string, { imports: string[]; packages: string[] }>();
  const queue = entries.map((e) => path.join(SRC, e));
  while (queue.length) {
    const file = queue.shift() as string;
    if (graph.has(file)) continue;
    const imports = valueImports(readFileSync(file, "utf8"));
    const packages: string[] = [];
    for (const spec of imports) {
      const target = resolve(file, spec);
      if (target) queue.push(target);
      else packages.push(spec);
    }
    graph.set(file, { imports, packages });
  }
  return graph;
}

describe("the browser's own read of a league (track BF)", () => {
  const graph = browserGraph();

  it("loads no node: module and no server module but src/server/limits.ts (plain numbers)", () => {
    expect(graph.size).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const [file, { imports, packages }] of graph) {
      for (const p of packages) if (p.startsWith("node:") || p === "server-only" || p.startsWith("@upstash/") || p === "iron-session") bad.push(`${rel(file)} imports ${p}`);
      for (const spec of imports) if (spec.startsWith("@/server/") && spec !== "@/server/limits") bad.push(`${rel(file)} imports ${spec}`);
    }
    expect(bad).toEqual([]);
    expect([...graph.keys()].map(rel)).toEqual(expect.arrayContaining(["adapters/espn/schema.ts", "adapters/sleeper/schemas.ts", "server/limits.ts", "lib/sha256.ts"]));
  });

  it("the pages' first load carries none of it: the read (zod, the adapters' schemas and tables) is loaded on demand", () => {
    const first = browserGraph(FIRST_LOAD);
    expect([...first.keys()].map(rel)).toContain("lib/leagueFetch.ts");
    expect([...first.keys()].map(rel)).not.toContain("lib/leagueRead.ts");
    expect([...first].filter(([, g]) => g.packages.includes("zod")).map(([f]) => rel(f))).toEqual([]);
    expect([...first.keys()].map(rel).filter((f) => f.startsWith("adapters/") && f !== "adapters/types.ts" && f !== "adapters/httpShared.ts")).toEqual([]);
    // leagueFetch.ts reaches it only through a dynamic import.
    expect(readFileSync(path.join(SRC, "lib/leagueFetch.ts"), "utf8")).toMatch(/import\("\.\/leagueRead"\)/);
  });

  it("every module there that builds zod schemas imports src/lib/zodJitless.ts first", () => {
    const zodUsers = [...graph].filter(([, g]) => g.packages.includes("zod")).map(([file]) => file);
    expect(zodUsers.map(rel)).toEqual(expect.arrayContaining(["adapters/espn/schema.ts", "adapters/sleeper/schemas.ts"]));
    const late = zodUsers.filter((f) => rel(f) !== "lib/zodJitless.ts" && valueImports(readFileSync(f, "utf8"))[0] !== "@/lib/zodJitless");
    expect(late.map(rel)).toEqual([]);
  });
});

describe("src/lib/zodJitless.ts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    z.config({ jitless: false });
  });

  it("leaves zod's compiled parsers on where there's no window (the server, tests)", async () => {
    vi.resetModules();
    const mod = await import("./zodJitless");
    expect(mod.ZOD_JITLESS).toBe(false);
  });

  it("turns them off in a page (a window)", async () => {
    vi.stubGlobal("window", {});
    vi.resetModules();
    const fresh = await import("zod");
    const mod = await import("./zodJitless");
    expect(mod.ZOD_JITLESS).toBe(true);
    expect(fresh.z.config().jitless).toBe(true);
    fresh.z.config({ jitless: false });
  });
});

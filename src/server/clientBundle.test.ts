/**
 * What the browser can load never reaches the server's code (B4 security review; planner reply to Checkpoint 7a, §4's
 * go/no-go: "the DynastyProcess map stays server-side"). The walk starts from every client entry the bundler builds: each
 * module whose first statement is "use client", and every Web Worker (src/workers/*.worker.ts, also reached through `new
 * URL(…, import.meta.url)`), and follows value imports and re-exports, dynamic import() and new URL(…, import.meta.url), as
 * the bundler does (type-only imports aside). Nothing it reaches may be a server module: src/server/* (but the plain
 * numbers of src/server/limits.ts), src/data/* (the player-ID crosswalk and the DynastyProcess map, among the rest),
 * src/app/api/*, or a package only the server has: a Node built-in, server-only, iron-session, @upstash/*, csv-parse.
 * src/lib/zodJitless.test.ts checks the browser's own read of a league more closely; this is the boundary for all of it.
 * Read from the sources; no build, no network.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

/** Every non-test TypeScript module under src/. */
function sources(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** A "use client" module: the directive is its first statement (comments before it allowed). */
const USE_CLIENT = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*["']use client["']/;

/** The client entries: "use client" modules and Web Workers. */
function clientEntries(): string[] {
  return sources().filter((f) => USE_CLIENT.test(readFileSync(f, "utf8")) || /^workers\/[^/]+\.worker\.ts$/.test(rel(f)));
}

/** A line that is only comment (JSDoc and block-comment lines start with "*" or "/*", line comments with "//"). */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

/**
 * A module's value imports, in the bundler's sense: static imports and re-exports (`import type`, `export type` and
 * all-type specifier lists left out; side-effect imports included), dynamic import(), and new URL(…, import.meta.url).
 */
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
  const code = source
    .split("\n")
    .filter((line) => !COMMENT_LINE.test(line))
    .join("\n");
  for (const m of code.matchAll(/\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) out.push(m[1] as string);
  for (const m of code.matchAll(/new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) out.push(m[1] as string);
  return out;
}

/**
 * A specifier as a module under src/, null for a package, "asset" for a file the bundler loads as such (a stylesheet, an
 * image), or "unresolved" for a path that names nothing.
 */
function resolve(from: string, spec: string): string | null | "asset" | "unresolved" {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  return /\.(css|svg|png|ico|json)$/.test(base) && existsSync(base) ? "asset" : "unresolved";
}

interface Reached {
  /** The module that first reached it (null: an entry). */
  from: string | null;
  packages: string[];
}

/** Every module the client entries reach, with the packages each imports. */
function clientGraph(entries: readonly string[]): { graph: Map<string, Reached>; unresolved: string[] } {
  const graph = new Map<string, Reached>();
  const unresolved: string[] = [];
  const queue: Array<[string, string | null]> = entries.map((e) => [e, null]);
  while (queue.length) {
    const [file, from] = queue.shift() as [string, string | null];
    if (graph.has(file)) continue;
    const packages: string[] = [];
    graph.set(file, { from, packages });
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      const target = resolve(file, spec);
      if (target === null) packages.push(spec);
      else if (target === "unresolved") unresolved.push(`${rel(file)} imports ${spec}`);
      else if (target !== "asset" && !graph.has(target)) queue.push([target, file]);
    }
  }
  return { graph, unresolved };
}

/** How a module was reached, entry first ("components/x.tsx → lib/y.ts → …"). */
function chain(graph: Map<string, Reached>, file: string): string {
  const steps: string[] = [];
  for (let f: string | null = file; f; f = graph.get(f)?.from ?? null) steps.unshift(rel(f));
  return steps.join(" → ");
}

/** Server-only modules under src/ (see the header). */
function isServerModule(file: string): boolean {
  const r = rel(file);
  return (r.startsWith("server/") && r !== "server/limits.ts") || r.startsWith("data/") || r.startsWith("app/api/");
}

const NODE_BUILTINS: ReadonlySet<string> = new Set(builtinModules);

/** Packages only the server has (see the header). */
function isServerPackage(spec: string): boolean {
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? spec);
  return spec.startsWith("node:") || NODE_BUILTINS.has(name) || ["server-only", "iron-session", "csv-parse"].includes(name) || name.startsWith("@upstash/");
}

describe("the browser's bundles never reach the server's code (B4 security review)", () => {
  const entries = clientEntries();
  const { graph, unresolved } = clientGraph(entries);

  it("finds the client entries: the pages' client components and the engine's worker", () => {
    expect(entries.length).toBeGreaterThanOrEqual(25);
    expect(entries.map(rel)).toEqual(expect.arrayContaining(["workers/engine.worker.ts", "components/connect/EspnConnect.tsx", "app/error.tsx"]));
    // The walk follows dynamic imports and workers' URLs: the league read loaded on demand, the worker the client starts.
    expect([...graph.keys()].map(rel)).toEqual(expect.arrayContaining(["lib/leagueRead.ts", "lib/engineClient.ts", "engine/search.ts", "server/limits.ts"]));
    expect(unresolved).toEqual([]);
  });

  it("reaches no server module: not src/server (but its limits' plain numbers), not src/data (the crosswalk, the DynastyProcess map), not src/app/api", () => {
    const bad = [...graph.keys()].filter(isServerModule).map((f) => chain(graph, f));
    expect(bad).toEqual([]);
  });

  it("imports no package only the server has: Node built-ins, server-only, iron-session, @upstash/*, csv-parse", () => {
    const bad: string[] = [];
    for (const [file, { packages }] of graph) for (const p of packages) if (isServerPackage(p)) bad.push(`${chain(graph, file)} imports ${p}`);
    expect(bad).toEqual([]);
  });

  it("would catch one (the walk's own check): a client module importing the crosswalk, a server module or node:fs", () => {
    expect(isServerModule(path.join(SRC, "data/crosswalk.ts"))).toBe(true);
    expect(isServerModule(path.join(SRC, "data/dynastyProcess.ts"))).toBe(true);
    expect(isServerModule(path.join(SRC, "server/session.ts"))).toBe(true);
    expect(isServerModule(path.join(SRC, "app/api/_lib/deps.ts"))).toBe(true);
    expect(isServerModule(path.join(SRC, "server/limits.ts"))).toBe(false);
    for (const p of ["node:fs", "fs", "zlib", "crypto/promises", "server-only", "iron-session", "@upstash/redis", "csv-parse/sync"]) expect(isServerPackage(p), p).toBe(true);
    for (const p of ["react", "next/link", "zod"]) expect(isServerPackage(p), p).toBe(false);
    const source = [
      '"use client";',
      'import type { Thing } from "@/server/session";',
      'import { type A, type B } from "@/data/types";',
      'import { canonical } from "@/data/crosswalk";',
      'export * from "./helpers";',
      "/** A comment naming import(\"@/server/budget\") isn't an import. */",
      'const later = () => import("@/server/log");',
      'const worker = new Worker(new URL("../workers/engine.worker.ts", import.meta.url));',
    ].join("\n");
    expect(valueImports(source)).toEqual(["@/data/crosswalk", "./helpers", "@/server/log", "../workers/engine.worker.ts"]);
  });
});

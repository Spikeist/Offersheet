/**
 * Output scrubbing: a last line of defence so secrets and private IDs from .env.local never reach
 * the console, reports, fixtures or error messages.
 *
 * - Scrubber replaces every registered value (and its URL-encoded / case / brace-less variants).
 * - installConsoleScrubber() routes console.* and uncaught errors through the scrubber.
 * - Purely numeric values only match whole numbers (so league ID 12345 never mangles 123456).
 */
import util from "node:util";
import { SENSITIVE_ENV_VARS, env } from "./env";

interface Rule {
  value: string;
  placeholder: string;
  numeric: boolean;
}

export class Scrubber {
  private rules: Rule[] = [];

  /** Register a value to scrub. Values shorter than 3 characters are ignored (too ambiguous). */
  add(value: string | number | null | undefined, placeholder: string): void {
    if (value === null || value === undefined) return;
    const v = String(value).trim();
    if (v.length < 3) return;
    for (const variant of variantsOf(v)) {
      if (variant.length < 3 || this.rules.some((r) => r.value === variant)) continue;
      this.rules.push({ value: variant, placeholder, numeric: /^\d+$/.test(variant) });
    }
    // Longest first, so a value that contains another registered value is replaced whole.
    this.rules.sort((a, b) => b.value.length - a.value.length);
  }

  get size(): number {
    return this.rules.length;
  }

  scrub(text: string): string {
    let out = text;
    for (const r of this.rules) {
      if (!out.includes(r.value)) continue;
      out = r.numeric
        ? out.replace(new RegExp(`(?<!\\d)${r.value}(?!\\d)`, "g"), r.placeholder)
        : out.split(r.value).join(r.placeholder);
    }
    return out;
  }

  /** Deep-scrub a JSON-like value. Numbers equal to a numeric secret become the placeholder string. */
  scrubDeep<T>(value: T): T {
    return this.walk(value) as T;
  }

  /** True if the text contains any registered value. */
  leaks(text: string): boolean {
    return this.scrub(text) !== text;
  }

  private walk(value: unknown): unknown {
    if (typeof value === "string") return this.scrub(value);
    if (typeof value === "number") {
      const s = String(value);
      const hit = this.rules.find((r) => r.numeric && r.value === s);
      return hit ? hit.placeholder : value;
    }
    if (Array.isArray(value)) return value.map((v) => this.walk(v));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[this.scrub(k)] = this.walk(v);
      return out;
    }
    return value;
  }
}

function variantsOf(v: string): Set<string> {
  const out = new Set<string>([v]);
  const add = (x: string) => {
    out.add(x);
    out.add(x.toLowerCase());
    out.add(x.toUpperCase());
  };
  add(v);
  add(encodeURIComponent(v));
  try {
    add(decodeURIComponent(v));
  } catch {
    // not %-encoded
  }
  const braced = /^\{(.+)\}$/.exec(v);
  if (braced?.[1]) add(braced[1]); // SWID without its braces
  return out;
}

/** The process-wide scrubber, pre-loaded with every sensitive .env.local value. */
export const secrets = new Scrubber();
let secretsLoaded = false;
export function loadSecretsIntoScrubber(): Scrubber {
  if (secretsLoaded) return secrets;
  for (const name of SENSITIVE_ENV_VARS) secrets.add(env(name), `[REDACTED:${name}]`);
  secretsLoaded = true;
  return secrets;
}

interface TextScrubber {
  scrubText(text: string): string;
}
const extraScrubbers: TextScrubber[] = [];

let consoleInstalled = false;
/** Route console output and uncaught errors through the scrubbers (secrets + any extras, e.g. a Redactor). */
export function installConsoleScrubber(...extra: TextScrubber[]): void {
  loadSecretsIntoScrubber();
  for (const x of extra) registerScrubber(x);
  if (consoleInstalled) return;
  consoleInstalled = true;
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => original(scrubEverything(util.format(...args)));
  }
  process.on("uncaughtException", (err) => {
    console.error("Uncaught error:", err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
  });
  process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
  });
}

/** Scrub text with the secrets scrubber and every registered extra scrubber (e.g. platform redactors). */
export function scrubEverything(text: string): string {
  loadSecretsIntoScrubber();
  return extraScrubbers.reduce((t, x) => x.scrubText(t), secrets.scrub(text));
}
/** Register an extra scrubber (e.g. a platform Redactor) for console output and reports. */
export function registerScrubber(x: TextScrubber): void {
  if (!extraScrubbers.includes(x)) extraScrubbers.push(x);
}

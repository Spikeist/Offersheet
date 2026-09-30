/**
 * FantasyCalc's API docs and terms of use are client-rendered: the text lives in the lazy-loaded
 * route chunks of the site's JS bundle. These pure helpers find the chunk for a route and pull
 * verbatim sentences out of it, so the report quotes the live text instead of paraphrasing it.
 */

/** The main bundle a page loads, e.g. "main-QU22HJEG.js". */
export function mainScriptSrc(html: string): string | null {
  return /<script[^>]*\bsrc="\/?(main-[A-Za-z0-9_-]+\.js)"/.exec(html)?.[1] ?? null;
}

/** The lazy chunk behind a router path, e.g. {path:"api-docs",…import("./chunk-UPDBX5JH.js")}. */
export function routeChunk(mainJs: string, route: string): string | null {
  const esc = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`path:"${esc}"[^{}]*?import\\(["']\\./(chunk-[A-Za-z0-9_-]+\\.js)["']\\)`).exec(mainJs)?.[1] ?? null;
}

function decodeEscape(s: string, i: number): [string, number] {
  const c = s[i + 1] ?? "";
  if (c === "u" && s[i + 2] === "{") {
    const end = s.indexOf("}", i + 3);
    return [String.fromCodePoint(parseInt(s.slice(i + 3, end), 16)), end + 1];
  }
  if (c === "u") return [String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)), i + 6];
  if (c === "x") return [String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)), i + 4];
  const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };
  return [simple[c] ?? c, i + 2];
}

/**
 * String literals in (minified) JS, escapes decoded. Template literals are included up to their
 * first ${…}. Good enough for pulling template text out of Angular chunks; not a full JS lexer.
 */
export function stringLiterals(js: string, minLength = 1): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < js.length) {
    const q = js[i];
    if (q !== '"' && q !== "'" && q !== "`") {
      i++;
      continue;
    }
    let s = "";
    let j = i + 1;
    let stop = false;
    while (j < js.length && js[j] !== q) {
      if (js[j] === "\\") {
        const [ch, next] = decodeEscape(js, j);
        s += ch;
        j = next;
        continue;
      }
      if (q === "`" && js[j] === "$" && js[j + 1] === "{") stop = true;
      if (!stop) s += js[j];
      j++;
    }
    if (s.length >= minLength) out.push(s);
    i = j + 1;
  }
  return out;
}

/** Collapse whitespace and mask e-mail addresses (reports carry no addresses). */
export function cleanQuote(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first literal containing `phrase` (case-sensitive), cleaned; null when the text changed. */
export function findLiteral(literals: string[], phrase: string): string | null {
  const hit = literals.find((l) => l.includes(phrase));
  return hit === undefined ? null : cleanQuote(hit);
}

/** Angular template instructions and tag names that sit between the text literals of a template. */
const TEMPLATE_NOISE = /^(a|p|b|i|em|strong|code|pre|div|span|section|table|thead|tbody|tr|th|td|h[1-6]|ul|ol|li|br|href|routerLink|fragment|id|class)$/;

/**
 * The text between two marker literals, joined into one line: e.g. the query-parameter table of
 * the API docs ("Query parameters" … "Example request").
 */
export function textBetween(literals: string[], start: string, end: string): string | null {
  const a = literals.findIndex((l) => l.trim() === start);
  if (a < 0) return null;
  const b = literals.findIndex((l, i) => i > a && l.trim() === end);
  if (b < 0) return null;
  return cleanQuote(
    literals
      .slice(a + 1, b)
      .filter((l) => !TEMPLATE_NOISE.test(l.trim()))
      .join(" "),
  );
}

/** Documented endpoints: headings like "GET /values/current". */
export function documentedEndpoints(literals: string[]): string[] {
  return [...new Set(literals.map((l) => l.trim()).filter((l) => /^(GET|POST) \/\S+$/.test(l)))];
}

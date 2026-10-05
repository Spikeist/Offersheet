/**
 * The HTTP clients' shared, pure helpers (planner reply to Checkpoint 4c, Part B, B1: browser fetching; track BF): the
 * server's polite client (src/server/http.ts) and the browser's own (src/lib/browserHttp.ts) read answers the same way, so
 * an adapter sees the same HttpResponse whichever side fetched it.
 *
 * - looksLikeHtml: an HTML page (an ESPN login page, a CDN's error page) rather than data.
 * - quoteBigInts / parseJson: JSON with 16+ digit integers kept as strings (Sleeper sends some 19-digit ids as bare
 *   numbers; HttpRequestOptions.bigIntsAsStrings), and undefined for anything that isn't JSON.
 * - retryAfterMs: a Retry-After header in ms.
 * - responseOf: the HttpResponse for a status, content type and body.
 *
 * Browser-safe: no node: imports, no server modules.
 */
import type { HttpResponse } from "./types";

/** True when an answer is an HTML page (by its content type, or a body that starts like one) rather than data. */
export function looksLikeHtml(contentType: string, text: string): boolean {
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) return true;
  const head = text.slice(0, 1024).trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return false;
  return /<(!doctype\s+html|html[\s>])/i.test(head);
}

/** Retry-After in ms (delta-seconds or an HTTP date), or undefined. */
export function retryAfterMs(value: string | null | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** Quote bare integers of 16+ digits (outside strings) so JSON.parse keeps every digit. */
export function quoteBigInts(text: string, minDigits = 16): string {
  let out = "";
  let last = 0;
  let inString = false;
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i += 2;
      else {
        if (c === 34) inString = false;
        i++;
      }
      continue;
    }
    if (c === 34) {
      inString = true;
      i++;
      continue;
    }
    if (c === 45 || isDigit(c)) {
      const start = i;
      let j = c === 45 ? i + 1 : i;
      const intStart = j;
      while (j < text.length && isDigit(text.charCodeAt(j))) j++;
      const intDigits = j - intStart;
      let integer = true;
      if (text[j] === ".") {
        integer = false;
        j++;
        while (j < text.length && isDigit(text.charCodeAt(j))) j++;
      }
      if (text[j] === "e" || text[j] === "E") {
        integer = false;
        j++;
        if (text[j] === "+" || text[j] === "-") j++;
        while (j < text.length && isDigit(text.charCodeAt(j))) j++;
      }
      if (integer && intDigits >= minDigits) {
        out += `${text.slice(last, start)}"${text.slice(start, j)}"`;
        last = j;
      }
      i = Math.max(j, i + 1);
      continue;
    }
    i++;
  }
  return last === 0 ? text : out + text.slice(last);
}

/** The body as JSON (16+ digit integers as strings with `bigInts`), or undefined when it isn't JSON. */
export function parseJson(text: string, bigInts: boolean): unknown {
  const t = text.trimStart();
  if (!(t.startsWith("{") || t.startsWith("[") || t === "null")) return undefined;
  try {
    return JSON.parse(bigInts ? quoteBigInts(text) : text);
  } catch {
    return undefined;
  }
}

/** The HttpResponse for an answer (status 0: none), its body parsed as JSON when it is some. */
export function responseOf(answer: { status: number; contentType: string; text: string }, opts: { fromCache: boolean; bigInts: boolean; fetchedAt?: number | undefined }): HttpResponse {
  return {
    status: answer.status,
    ok: answer.status >= 200 && answer.status < 300,
    isHtml: looksLikeHtml(answer.contentType, answer.text),
    json: parseJson(answer.text, opts.bigInts),
    text: answer.text,
    fromCache: opts.fromCache,
    ...(opts.fetchedAt !== undefined ? { fetchedAt: opts.fetchedAt } : {}),
  };
}

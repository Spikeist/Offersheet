/**
 * Shared plumbing for the API route handlers: JSON responses (never cached), request-body parsing
 * with zod, a same-origin check for requests that use or change credentials, and the mapping from
 * adapter errors to { error: { code, message } }. Nothing here logs request bodies or cookies.
 */
import type { z } from "zod";
import { LeagueImportError, type ImportErrorCode } from "@/adapters/types";
import type { PlayerIdResolver } from "@/data/types";
import type { Platform } from "@/engine/model";
import type { ApiErrorResponse, DataSourceStamp } from "@/lib/api";
import { errorMessage, errorStatus, isImportErrorCode, redactSecrets, type AppErrorCode } from "@/lib/errors";

/** Request bodies are tiny (an ID, a season, two cookies); anything bigger is refused unread. */
const MAX_BODY_CHARS = 16_384;

export function jsonResponse(body: unknown, init: { status?: number; headers?: Headers } = {}): Response {
  const headers = init.headers ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export function errorResponse(code: AppErrorCode, message: string = errorMessage(code), headers?: Headers): Response {
  const body: ApiErrorResponse = { error: { code, message } };
  return jsonResponse(body, { status: errorStatus(code), headers });
}

export type BodyResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** zod issue → one user-facing sentence (schemas carry their own messages; values are never echoed). */
function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return errorMessage("INVALID_REQUEST");
  const custom = issue.message && !/^Invalid input|^Expected|^Too (small|big)|^Required/i.test(issue.message) ? issue.message : undefined;
  if (custom) return custom;
  const field = issue.path.map(String).join(".");
  return field ? `The "${field}" field isn't valid.` : errorMessage("INVALID_REQUEST");
}

/** The body as text, or "too-large" as soon as it passes `max` bytes (never buffers more than that). */
async function readTextCapped(request: Request, max: number): Promise<string | "too-large"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return "too-large";
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Our pages always send JSON; a form post or text/plain body (a cross-site "simple request") is refused unread. */
function isJsonContentType(value: string | null): boolean {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";
}

export async function readJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<BodyResult<T>> {
  if (!isJsonContentType(request.headers.get("content-type"))) return { ok: false, message: "That request wasn't sent as JSON." };
  let text: string;
  try {
    const read = await readTextCapped(request, MAX_BODY_CHARS);
    if (read === "too-large") return { ok: false, message: "That request is too large." };
    text = read;
  } catch {
    return { ok: false, message: "We couldn't read that request." };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: "That request wasn't valid JSON." };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, message: issueMessage(parsed.error) };
}

/** First value of a comma-separated forwarding header. */
function firstHeaderValue(request: Request, name: string): string | undefined {
  const v = request.headers.get(name)?.split(",")[0]?.trim();
  return v ? v : undefined;
}

/** `scheme//host` normalized the way URL.origin is (default ports dropped), or undefined. */
function originOf(scheme: string, host: string): string | undefined {
  try {
    return new URL(`${scheme}//${host}`).origin;
  } catch {
    return undefined;
  }
}

/**
 * Browsers send Origin on POST and DELETE. A request is allowed when its Origin is this site's own
 * (scheme and host). Without Origin (curl, tests, old browsers), a browser's Sec-Fetch-Site must
 * not say another site sent it. An http:// page may not post to the https:// site.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
    return !site || site === "same-origin" || site === "none";
  }
  let from: URL;
  try {
    from = new URL(origin);
  } catch {
    return false; // "null" (sandboxed frames, file:, some redirects) and anything unparsable
  }
  if (from.protocol !== "http:" && from.protocol !== "https:") return false;

  let url: URL | undefined;
  try {
    url = new URL(request.url);
  } catch {
    url = undefined;
  }
  const hosts = [request.headers.get("host") ?? undefined, firstHeaderValue(request, "x-forwarded-host"), url?.host].filter((h): h is string => Boolean(h));
  // The scheme the browser used: the proxy's X-Forwarded-Proto when there is one (Vercel sets it),
  // else the request URL's. A proxy can also end TLS without saying so, so an https page of this
  // host is accepted on a plain-http request; the reverse (an http page posting to https) is not.
  const forwardedProto = firstHeaderValue(request, "x-forwarded-proto");
  const schemes = new Set<string>();
  if (forwardedProto) schemes.add(`${forwardedProto.toLowerCase().replace(/:$/, "")}:`);
  else if (url) schemes.add(url.protocol);
  if (schemes.has("http:")) schemes.add("https:");
  const allowed = new Set<string>();
  for (const scheme of schemes) for (const host of hosts) {
    const o = originOf(scheme, host);
    if (o) allowed.add(o);
  }
  return allowed.has(from.origin);
}

function asImportError(err: unknown): { code: ImportErrorCode; message: string } | undefined {
  if (err instanceof LeagueImportError) return err;
  if (err && typeof err === "object" && (err as { name?: unknown }).name === "LeagueImportError") {
    const code = (err as { code?: unknown }).code;
    const message = (err as { message?: unknown }).message;
    if (isImportErrorCode(code)) return { code, message: typeof message === "string" ? message : "" };
  }
  return undefined;
}

/** Server log for unexpected failures: redacted, and only the error's name in production. */
export function logUnexpected(where: string, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  const detail = process.env.NODE_ENV === "development" && err instanceof Error ? `: ${redactSecrets(err.message).slice(0, 500)}` : "";
  console.error(`[offer-sheet] ${where} failed unexpectedly (${name})${detail}`);
}

export function importErrorResponse(err: unknown, ctx: { platform: Platform; season?: number }): Response {
  const known = asImportError(err);
  if (known) return errorResponse(known.code, errorMessage(known.code, { platform: ctx.platform, adapterMessage: known.message, season: ctx.season }));
  logUnexpected(`${ctx.platform} import`, err);
  return errorResponse("INTERNAL");
}

interface SourceStatusLike {
  name: string;
  fetchedAt: string | null;
  fromCache?: boolean;
  available?: boolean;
  note?: string;
}

/**
 * Import Report timestamps for the shared data. Uses the resolver's richer status() when it has one
 * (src/data's crosswalk: cached vs unavailable), else the PlayerIdResolver contract's sources().
 */
export function dataSourceStamps(resolver: PlayerIdResolver): DataSourceStamp[] {
  const withStatus = resolver as PlayerIdResolver & { status?: () => SourceStatusLike[] };
  if (typeof withStatus.status === "function") {
    return withStatus.status().map((s) => ({
      name: s.name,
      fetchedAt: s.fetchedAt,
      ...(s.fromCache !== undefined ? { fromCache: s.fromCache } : {}),
      ...(s.available !== undefined ? { available: s.available } : {}),
      ...(s.note ? { note: redactSecrets(s.note) } : {}),
    }));
  }
  return resolver.sources().map((s) => ({ name: s.name, fetchedAt: s.fetchedAt }));
}

const GUID_PATTERN = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}";
/** A SWID in braces, or with the braces URL-encoded (%7B…%7D, either case). */
const SWID_LIKE = new RegExp(`\\{${GUID_PATTERN}\\}|%7[Bb]${GUID_PATTERN}%7[Dd]`, "g");
const GUID_ONLY = new RegExp(`^${GUID_PATTERN}$`);

/** The bare GUID of a SWID as typed ("{…}", "%7B…%7D" or bare), or undefined. */
function bareGuid(swid: string): string | undefined {
  const bare = swid
    .trim()
    .replace(/^(\{|%7B)/i, "")
    .replace(/(\}|%7D)$/i, "");
  return GUID_ONLY.test(bare) ? bare : undefined;
}

/**
 * Safety net for §0.5 (SWIDs are secrets everywhere): replaces anything shaped like a SWID in a
 * response body, braced or %7B-encoded, plus the known SWIDs (the user's own cookie) in any form or
 * case, bare included. (Bare GUIDs in general stay: ESPN uses them for transaction IDs.) Adapters
 * shouldn't emit any; if one does, it's logged (count only) as a bug.
 */
export function scrubSwids<T>(body: T, where: string, knownSwids: readonly string[] = []): T {
  const text = JSON.stringify(body);
  const known = [...new Set(knownSwids.map(bareGuid).filter((g): g is string => Boolean(g)))];
  const patterns = [SWID_LIKE, ...known.map((g) => new RegExp(g.replace(/-/g, "\\-"), "gi"))];
  let hits = 0;
  let out = text;
  for (const p of patterns) {
    out = out.replace(p, () => {
      hits++;
      return "{SWID}";
    });
  }
  if (!hits) return body;
  console.error(`[offer-sheet] ${where}: replaced ${hits} SWID-like value(s) in the response; the adapter should not emit them`);
  return JSON.parse(out) as T;
}

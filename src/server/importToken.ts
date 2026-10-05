/**
 * Signed imports (planner reply to Checkpoint 4c, Part B, B1: browser fetching; track BF): so the model route needs
 * neither a re-import nor a re-upload. Every import the server answers (read by the server itself or by the browser) carries
 * a token over exactly what the model build reads of it, the snapshot and the import's model part (ESPN's league-scored
 * projections; nothing for Sleeper):
 *
 *   token = base64url(HMAC-SHA256(derivedKey("import-token/v1"), "v1|<platform>|<issuedAt>|" + sha256(canonical JSON)))
 *
 * The League page keeps the import with its token and sends it back to the model route, which checks it (issued by this
 * server's secret at most browserFetchLimits.tokenMaxAgeMs ago, not in the future past tokenFutureSkewMs) and builds the
 * model inputs from it without reading the league again. A token that doesn't check out (no SESSION_SECRET when it was
 * made, another secret since, an import changed in the browser, one too old) just means the model route reads the league
 * itself, as it always did.
 *
 * - The canonical JSON sorts every object's keys and leaves out properties whose value is undefined, as JSON does, so the
 *   browser's copy (stored in IndexedDB, sent as JSON) hashes the same as the object the server signed.
 * - The key is derived from SESSION_SECRET (src/server/redis.ts derivedKey): without it no import is signed. ⚠️ Rotating
 *   SESSION_SECRET makes every saved token stale (the model route then reads the league once more).
 * - What it proves: this server built that snapshot and model part (from the browser's responses or its own), so the
 *   model route never builds inputs for a snapshot nobody imported. It says nothing about who holds it: a token goes with
 *   its import, like the import itself (no credentials or secrets are in either).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Platform } from "@/engine/model";
import { browserFetchLimits } from "./limits";
import { derivedKey } from "./redis";

type Env = Readonly<Record<string, string | undefined>>;

/** The label of the token's key (src/server/redis.ts derivedKey). */
export const IMPORT_TOKEN_LABEL = "import-token/v1";

/** A signature of an import: when it was made (epoch ms, the server's clock) and the token. */
export interface ImportSignature {
  issuedAt: number;
  token: string;
}

/** What a token covers: the snapshot and the import's model part, as the model build reads them. */
export interface SignedContent {
  snapshot: unknown;
  modelPart: unknown;
}

/** JSON with every object's keys sorted and undefined properties left out (see the header); a value JSON can't hold reads null. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const text = JSON.stringify(value);
    return text === undefined ? "null" : text;
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined || typeof v === "function" || typeof v === "symbol" ? "null" : canonicalJson(v))).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined && typeof record[k] !== "function" && typeof record[k] !== "symbol")
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

/**
 * The sha256 (hex) of what a token covers, its canonical JSON (see the header). Computed once per request: the model routes
 * check the signature with it (signatureProblem) and file the answer they build under it (final review SEC-1: a signed
 * import posted again is answered from memory, src/app/api/model/memo.ts).
 */
export function importDigest(content: SignedContent): string {
  return createHash("sha256").update(canonicalJson({ snapshot: content.snapshot, modelPart: content.modelPart })).digest("hex");
}

function tokenFor(key: Buffer, platform: Platform, issuedAt: number, contentDigest: string): string {
  return createHmac("sha256", key).update(`v1|${platform}|${issuedAt}|${contentDigest}`).digest("base64url");
}

/** The signature for an import made now, or undefined without SESSION_SECRET (the model route then reads the league itself). */
export function signImport(platform: Platform, content: SignedContent, now: number = Date.now(), env: Env = process.env): ImportSignature | undefined {
  const key = derivedKey(IMPORT_TOKEN_LABEL, env);
  if (!key) return undefined;
  const issuedAt = Math.floor(now);
  return { issuedAt, token: tokenFor(key, platform, issuedAt, importDigest(content)) };
}

/** Why a signature doesn't check out for content whose importDigest is `contentDigest`, or null when it does. Never throws. */
export function signatureProblem(platform: Platform, contentDigest: string, signature: ImportSignature, now: number = Date.now(), env: Env = process.env): string | null {
  const key = derivedKey(IMPORT_TOKEN_LABEL, env);
  if (!key) return "no key to check it with";
  const { issuedAt, token } = signature;
  if (!Number.isSafeInteger(issuedAt) || typeof token !== "string") return "malformed";
  if (issuedAt > now + browserFetchLimits.tokenFutureSkewMs) return "issued in the future";
  if (now - issuedAt > browserFetchLimits.tokenMaxAgeMs) return "too old";
  let expected: Buffer;
  let given: Buffer;
  try {
    expected = Buffer.from(tokenFor(key, platform, issuedAt, contentDigest));
    given = Buffer.from(token);
  } catch {
    return "malformed";
  }
  return expected.length === given.length && timingSafeEqual(expected, given) ? null : "doesn't match";
}

/** Why a signature doesn't check out, or null when it does (see the header). Never throws. */
export function importSignatureProblem(platform: Platform, content: SignedContent, signature: ImportSignature, now: number = Date.now(), env: Env = process.env): string | null {
  return signatureProblem(platform, importDigest(content), signature, now, env);
}

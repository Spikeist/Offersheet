/**
 * Read-only access to the beta's shared store (Upstash) for the local scripts that read it on purpose: `npm run beta:log`,
 * `usage:report`, `feedback:report` and `snapshot:pull`, each with `-- --live` (Parker, 2026-10-07: "make the local scripts
 * that read Upstash use a read-only token, under variable names the app never reads. That way the token on my computer
 * can't change anything, and local runs never touch the shared store.").
 *
 * - Two variables of its own, typed into .env.local by hand: READONLY_STORE_URL, the store's REST address (the value of
 *   Vercel's KV_REST_API_URL), and READONLY_STORE_TOKEN, Upstash's read-only token (the value of
 *   KV_REST_API_READ_ONLY_TOKEN). Nothing under src/ reads either name (storeReader.test.ts scans it), and the scripts read
 *   no other store variable: the app's own (KV_REST_API_URL and KV_REST_API_TOKEN, or Upstash's UPSTASH_REDIS_REST_URL and
 *   UPSTASH_REDIS_REST_TOKEN) are read on Vercel only (src/server/redis.ts), so `npm run dev`, the stable copy,
 *   check:browser, the tests and every other script never reach the store.
 * - The reader holds the three read commands the scripts use (MGET, LRANGE, SMEMBERS) and nothing else, in its type and at
 *   runtime.
 * - Before the first read, one check that the token can't write, which fails closed (review of the follow-ups to
 *   Checkpoint 7b, SEC-1): a DEL of READONLY_CHECK_KEY, a key nothing ever writes (every key the app writes starts with
 *   keyPrefix(), `os:<scope>:` with a scope of letters only). The reader opens only when Upstash refuses that DEL with its
 *   permission error (READ_ONLY_REFUSAL), as it refuses any write made with a read-only token. A DEL carried out means a
 *   token that can change the store: the script stops. Anything else (no answer, a 5xx, a 429, a 401, a page that isn't
 *   JSON, an error that isn't a permission refusal) is no answer to the question, so the check is tried once more, a
 *   second later. That second try opens the reader only when it too is refused for permissions; a DEL it carries out, or a
 *   second unclear answer, stops the script, and nothing is read. Deleting a key that doesn't exist changes nothing.
 *   ⚠️ Upstash's wording of the refusal is assumed (Redis's ACL code NOPERM; Upstash's docs say only "Read Only token
 *   permits access to the read commands only"): no live run has seen it yet. Were it worded otherwise, every run would
 *   stop with "Couldn't confirm …", never reading with a token that could write. ⚠️ The check proves only that the token
 *   can't delete that one key: a custom ACL token kept away from it by key patterns (made by hand with ACL SETUSER and
 *   ACL RESTTOKEN; Vercel's two tokens aren't such) would pass. The documented setup names the read-only token's value.
 * - No SESSION_SECRET: every key these scripts read is plain (`os:<env>:log:…`, `usage:…`, `work:…`, `budget:…`, `fb:…`,
 *   `snap:…`); the HMAC'd keys (the server cache, the rate limits, a visitor's counts) are never read here.
 * - Messages name variables and say "set" or "blank", never a value. Errors are reported by name only: an Upstash error's
 *   message carries the command, and the SDK's UrlError carries the address.
 */
import { Redis } from "@upstash/redis";
import { redisClientLimits } from "@/server/limits";
import type { RedisLike } from "@/server/redis";

type Env = Readonly<Record<string, string | undefined>>;

/** The store's REST address (https://…), typed into .env.local by hand. Only this module reads it. */
export const READONLY_STORE_URL = "READONLY_STORE_URL";
/** Upstash's read-only token for that address, typed into .env.local by hand. Only this module reads it. */
export const READONLY_STORE_TOKEN = "READONLY_STORE_TOKEN";

/** The key the write check deletes. Nothing writes it: it has no keyPrefix() scope (src/server/redis.ts). */
export const READONLY_CHECK_KEY = "os:readonly-check";

/**
 * Upstash's refusal of a write made with a read-only token, as its message reads (matched, never printed): Redis's ACL
 * error code, "NOPERM this user has no permissions to run the 'del' command" (⚠️ assumed: see the header). Never wider:
 * a store refusing writes for another reason (a read-only replica's READONLY, a full database) says nothing about the token.
 */
const READ_ONLY_REFUSAL = /\bNOPERM\b|\bno permissions?\b/i;

/** How long the write check waits before its second try when the first got no clear answer. */
export const STORE_CHECK_RETRY_MS = 1_000;

/** What the scripts read with: the read commands they use, nothing else. */
export type StoreReader = Pick<RedisLike, "mget" | "lrange" | "smembers">;

/** Where the two values come from (CLAUDE.md §0.5, .env.example). */
export const STORE_READER_SETUP =
  `In Vercel, open Storage → upstash-kv-alizarin-saddle and type the values of KV_REST_API_URL and KV_REST_API_READ_ONLY_TOKEN ` +
  `into .env.local as ${READONLY_STORE_URL} and ${READONLY_STORE_TOKEN}, by hand (never \`vercel env pull\`, which rewrites .env.local).`;

/** The address and token to read with, or why there are none (by variable name, never a value). */
export function storeReaderSetup(env: Env): { url: string; token: string } | { error: string } {
  if (env.OFFERSHEET_NETWORK === "off") return { error: "The network is off: the shared store is read only with --live." };
  const url = env[READONLY_STORE_URL]?.trim();
  const token = env[READONLY_STORE_TOKEN]?.trim();
  if (!url || !token) {
    return {
      error: `No read-only access to the shared store in .env.local (${READONLY_STORE_URL} ${url ? "set" : "blank"}, ${READONLY_STORE_TOKEN} ${token ? "set" : "blank"}). ${STORE_READER_SETUP}`,
    };
  }
  // A redis:// connection string (Vercel lists KV_URL and REDIS_URL next to the two values) carries the store's full
  // password, in either variable (review of the follow-ups to Checkpoint 7b, SEC-2).
  for (const [name, value] of [
    [READONLY_STORE_URL, url],
    [READONLY_STORE_TOKEN, token],
  ] as const) {
    if (/rediss?:\/\//i.test(value)) {
      return {
        error: `${name} holds a connection string (redis://…), which carries the store's full password: delete it from .env.local. ${STORE_READER_SETUP}`,
      };
    }
  }
  if (!/^https:\/\/\S+$/i.test(url)) return { error: `${READONLY_STORE_URL} isn't an https:// address. ${STORE_READER_SETUP}` };
  // Upstash's REST tokens never contain "://".
  if (/:\/\//.test(token)) return { error: `${READONLY_STORE_TOKEN} holds an address, not a token. ${STORE_READER_SETUP}` };
  return { url, token };
}

/** Test hooks: the wait before the write check's second try. */
export interface StoreReaderOptions {
  retryDelayMs?: number;
}

/**
 * The read-only reader, once the store refused the write check (header), or why there is none: the token can write, the
 * check got no clear answer twice, or the setup is wrong. One check per call: each script opens one reader.
 */
export async function openStoreReader(env: Env = process.env, opts: StoreReaderOptions = {}): Promise<{ reader: StoreReader } | { error: string }> {
  const setup = storeReaderSetup(env);
  if ("error" in setup) return setup;
  let client: Redis;
  try {
    client = new Redis({
      url: setup.url,
      token: setup.token,
      automaticDeserialization: false,
      enableTelemetry: false,
      responseEncoding: false,
      retry: { retries: redisClientLimits.retries, backoff: () => redisClientLimits.retryBackoffMs },
    });
  } catch (err) {
    return { error: `${READONLY_STORE_URL} can't be used (${errorName(err)}). ${STORE_READER_SETUP}` };
  }
  let check = await checkToken(client);
  if (check.kind === "unclear") {
    await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs ?? STORE_CHECK_RETRY_MS));
    check = await checkToken(client);
  }
  if (check.kind === "writes") {
    return {
      error:
        `${READONLY_STORE_TOKEN} can change the shared store: it is a full-access token, not the read-only one. Nothing was read. ` +
        `Replace its value in .env.local with KV_REST_API_READ_ONLY_TOKEN's (not KV_REST_API_TOKEN's). ${STORE_READER_SETUP}`,
    };
  }
  if (check.kind === "unclear") {
    return {
      error:
        `Couldn't confirm that ${READONLY_STORE_TOKEN} is read-only (the store's check answered ${check.errorName}), so nothing was read. ` +
        `Try again in a minute. If it keeps happening, check ${READONLY_STORE_URL} and ${READONLY_STORE_TOKEN} in .env.local; ` +
        `if they're right, the store may word its refusal differently than this check expects (scripts/lib/storeReader.ts).`,
    };
  }
  return { reader: readerOf(client) };
}

type TokenCheck = { kind: "writes" } | { kind: "readOnly" } | { kind: "unclear"; errorName: string };

/** The write check (header): the DEL carried out, refused for permissions, or neither. */
async function checkToken(client: Redis): Promise<TokenCheck> {
  try {
    await client.del(READONLY_CHECK_KEY);
    return { kind: "writes" };
  } catch (err) {
    // Only Upstash's own refusal counts; its message is matched here and never printed.
    if (err instanceof Error && err.name === "UpstashError" && READ_ONLY_REFUSAL.test(err.message)) return { kind: "readOnly" };
    return { kind: "unclear", errorName: errorName(err) };
  }
}

function readerOf(client: Redis): StoreReader {
  return Object.freeze({
    mget: (...keys: string[]) => (keys.length ? client.mget<Array<string | null>>(...keys) : Promise.resolve([])),
    lrange: (key: string, start: number, stop: number) => client.lrange<string>(key, start, stop),
    smembers: (key: string) => client.smembers<string[]>(key),
  });
}

/** A script's line when it failed: the error's name only (header), and where to look when the store refused it. */
export function storeFailureText(script: string, err: unknown): string {
  const name = errorName(err);
  const refused = name.startsWith("Upstash")
    ? ` The store refused the request or answered something unexpected: check ${READONLY_STORE_URL} and ${READONLY_STORE_TOKEN} in .env.local.`
    : "";
  return `${script} failed (${name}).${refused}`;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

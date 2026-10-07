/**
 * The store-reading scripts' read-only access (scripts/lib/storeReader.ts; Parker, 2026-10-07: "make the local scripts that
 * read Upstash use a read-only token, under variable names the app never reads"). No network: the SDK's fetch is stubbed,
 * and every value here is made up.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOT } from "./env";
import { keyPrefix } from "@/server/redis";
import {
  READONLY_CHECK_KEY,
  READONLY_STORE_TOKEN,
  READONLY_STORE_URL,
  STORE_CHECK_RETRY_MS,
  openStoreReader,
  storeFailureText,
  storeReaderSetup,
} from "./storeReader";

const URL_VALUE = "https://made-up-db.upstash.invalid";
const READ_ONLY_TOKEN = "MADE-UP-READ-ONLY-TOKEN";
const FULL_TOKEN = "MADE-UP-FULL-ACCESS-TOKEN";
const READ_ONLY_ENV = { [READONLY_STORE_URL]: URL_VALUE, [READONLY_STORE_TOKEN]: READ_ONLY_TOKEN };
const FULL_ENV = { ...READ_ONLY_ENV, [READONLY_STORE_TOKEN]: FULL_TOKEN };
/** The app's own store variables, as someone might have left them in .env.local: the reader must never use them. */
const APP_STORE_VARS = {
  KV_REST_API_URL: "https://made-up-app-db.upstash.invalid",
  KV_REST_API_TOKEN: FULL_TOKEN,
  UPSTASH_REDIS_REST_URL: "https://made-up-app-db.upstash.invalid",
  UPSTASH_REDIS_REST_TOKEN: FULL_TOKEN,
  SESSION_SECRET: "s".repeat(40),
  VERCEL: "1",
};
const NO_WAIT = { retryDelayMs: 0 };

/** Redis's ACL refusal, as the stub's read-only store words it (⚠️ Upstash's own wording is assumed: storeReader.ts). */
const WRITE_REFUSED = "NOPERM this user has no permissions to run the 'del' command";

interface Sent {
  url: string;
  auth: string | undefined;
  commands: unknown[][];
}
type Reply = { status: number; body: string } | "throw";

/**
 * Upstash's REST API, stubbed: one command (POST /) or, as the SDK batches the commands of one tick, a pipeline
 * (POST /pipeline). `reply` answers each request; n counts the requests from 0. "throw" is a network failure.
 */
function stubStore(reply: (commands: unknown[][], n: number, pipeline: boolean) => Reply): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as unknown[];
    const pipeline = String(url).endsWith("/pipeline");
    const commands = (pipeline ? body : [body]) as unknown[][];
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const n = sent.length;
    sent.push({ url: String(url), auth: headers.authorization, commands });
    const r = reply(commands, n, pipeline);
    if (r === "throw") throw new TypeError("fetch failed");
    const json = /^[[{]/.test(r.body);
    return new Response(r.body, { status: r.status, headers: { "content-type": json ? "application/json" : "text/html" } });
  });
  return sent;
}

const json = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body) });

/** A store answering each command: a pipeline gets the answers in a list, one command its own (an error as a 400). */
function answering(answer: (command: unknown[]) => { result?: unknown; error?: string }) {
  return (commands: unknown[][], _n: number, pipeline: boolean): Reply => {
    const answers = commands.map(answer);
    if (!pipeline && answers[0]?.error) return json(400, answers[0]);
    return json(200, pipeline ? answers : answers[0]);
  };
}

/** Behind a read-only token: reads answer, the DEL is refused for permissions. */
const READ_ONLY_STORE = answering((command) => {
  switch (command[0]) {
    case "mget":
      return { result: command.slice(1).map((_, i) => (i === 0 ? "7" : null)) };
    case "lrange":
      return { result: ['{"a":1}'] };
    case "smembers":
      return { result: ["x"] };
    default:
      return { error: WRITE_REFUSED };
  }
});

/** Behind a full-access token: every command is carried out (the DEL of a key that doesn't exist deletes 0). */
const FULL_ACCESS_STORE = answering((command) => (command[0] === "del" ? { result: 0 } : command[0] === "mget" ? { result: ["42"] } : { result: null }));

/** The store answers the first `times` requests with `failure`, then as `store` does. */
const failingFirst = (times: number, failure: Reply, store: ReturnType<typeof answering>) => (commands: unknown[][], n: number, pipeline: boolean) =>
  n < times ? failure : store(commands, n, pipeline);

const commandNames = (sent: Sent[]) => sent.flatMap((s) => s.commands.map((c) => String(c[0])));
const errorOf = (r: unknown): string => (r && typeof r === "object" && "error" in r ? String((r as { error: unknown }).error) : "");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storeReaderSetup: its own two variables, never a value in a message", () => {
  it("reads READONLY_STORE_URL and READONLY_STORE_TOKEN only, never the app's store variables", () => {
    const none = storeReaderSetup(APP_STORE_VARS);
    const urlOnly = storeReaderSetup({ ...APP_STORE_VARS, [READONLY_STORE_URL]: URL_VALUE });
    const tokenOnly = storeReaderSetup({ ...APP_STORE_VARS, [READONLY_STORE_TOKEN]: READ_ONLY_TOKEN });
    expect(errorOf(none)).toContain(`${READONLY_STORE_URL} blank, ${READONLY_STORE_TOKEN} blank`);
    expect(errorOf(urlOnly)).toContain(`${READONLY_STORE_URL} set, ${READONLY_STORE_TOKEN} blank`);
    expect(errorOf(tokenOnly)).toContain(`${READONLY_STORE_URL} blank, ${READONLY_STORE_TOKEN} set`);
    expect(storeReaderSetup({ ...APP_STORE_VARS, ...READ_ONLY_ENV })).toEqual({ url: URL_VALUE, token: READ_ONLY_TOKEN });
    // The results that hold one of the two values set, and the app's variables, never echo a value.
    const values = [...Object.values(APP_STORE_VARS), URL_VALUE, READ_ONLY_TOKEN].filter((v) => v.length > 1);
    for (const res of [none, urlOnly, tokenOnly]) for (const value of values) expect(JSON.stringify(res)).not.toContain(value);
  });

  it("says where the two values come from: Vercel's address and read-only token, typed in by hand", () => {
    const text = errorOf(storeReaderSetup({}));
    expect(text).toContain("KV_REST_API_URL");
    expect(text).toContain("KV_REST_API_READ_ONLY_TOKEN");
    expect(text).toContain("never `vercel env pull`");
  });

  it("refuses a redis:// connection string in either variable (it carries the store's full password), without echoing it", () => {
    const connection = "rediss://default:MADE-UP-PASSWORD@made-up-db.upstash.invalid:6379";
    for (const name of [READONLY_STORE_URL, READONLY_STORE_TOKEN]) {
      const res = storeReaderSetup({ ...READ_ONLY_ENV, [name]: connection });
      expect(errorOf(res)).toContain(`${name} holds a connection string`);
      expect(JSON.stringify(res)).not.toContain("MADE-UP-PASSWORD");
    }
  });

  it("refuses an address that isn't https://, and an address typed in as the token, without echoing either", () => {
    const http = storeReaderSetup({ ...READ_ONLY_ENV, [READONLY_STORE_URL]: "http://made-up-db.upstash.invalid" });
    expect(errorOf(http)).toContain("isn't an https:// address");
    expect(JSON.stringify(http)).not.toContain("made-up-db");
    const swapped = storeReaderSetup({ ...READ_ONLY_ENV, [READONLY_STORE_TOKEN]: URL_VALUE });
    expect(errorOf(swapped)).toContain(`${READONLY_STORE_TOKEN} holds an address, not a token`);
    expect(JSON.stringify(swapped)).not.toContain("made-up-db");
  });

  it("is off without --live (OFFERSHEET_NETWORK off)", () => {
    expect(errorOf(storeReaderSetup({ ...READ_ONLY_ENV, OFFERSHEET_NETWORK: "off" }))).toContain("--live");
  });
});

describe("openStoreReader: the write check fails closed", () => {
  it("a read-only token: the DEL is refused for permissions, then only read commands go out, each with that token", async () => {
    const sent = stubStore(READ_ONLY_STORE);
    const opened = await openStoreReader({ ...APP_STORE_VARS, ...READ_ONLY_ENV }, NO_WAIT);
    if (!("reader" in opened)) throw new Error(opened.error);
    const { reader } = opened;
    // Written out here, not read from the module: widening the reader takes an edit to this test.
    expect(Object.keys(reader).sort()).toEqual(["lrange", "mget", "smembers"]);
    expect(Object.isFrozen(reader)).toBe(true);
    expect(await reader.mget("os:preview:a", "os:preview:b")).toEqual(["7", null]);
    expect(await reader.mget()).toEqual([]);
    expect(await reader.lrange("os:preview:log:2026-10-07", 0, -1)).toEqual(['{"a":1}']);
    expect(await reader.smembers("os:production:snap:x")).toEqual(["x"]);
    // The one write it ever sends is the check: a DEL of a key nothing writes, which this token can't carry out.
    expect(sent[0]?.commands).toEqual([["del", READONLY_CHECK_KEY]]);
    expect(commandNames(sent.slice(1))).toEqual(["mget", "lrange", "smembers"]);
    for (const s of sent) {
      expect(s.url.startsWith(URL_VALUE)).toBe(true);
      expect(s.auth).toBe(`Bearer ${READ_ONLY_TOKEN}`);
    }
    expect(JSON.stringify(sent)).not.toContain(FULL_TOKEN);
    expect(JSON.stringify(sent)).not.toContain("made-up-app-db");
  });

  it("a read-only token whose whole request the store refuses (a 400 with the permission error) opens too", async () => {
    stubStore((commands, n, pipeline) => (commands.some((c) => c[0] === "del") ? json(400, { error: WRITE_REFUSED }) : READ_ONLY_STORE(commands, n, pipeline)));
    const opened = await openStoreReader(READ_ONLY_ENV, NO_WAIT);
    expect("reader" in opened).toBe(true);
  });

  it("a full-access token: the DEL of a key that doesn't exist is carried out (nothing changes), and nothing is read", async () => {
    const sent = stubStore(FULL_ACCESS_STORE);
    const opened = await openStoreReader(FULL_ENV, NO_WAIT);
    expect(errorOf(opened)).toContain(`${READONLY_STORE_TOKEN} can change the shared store`);
    expect(errorOf(opened)).toContain("Nothing was read");
    expect(errorOf(opened)).toContain("KV_REST_API_READ_ONLY_TOKEN");
    expect(JSON.stringify(opened)).not.toContain(FULL_TOKEN);
    expect(commandNames(sent)).toEqual(["del"]);
  });

  it("a full-access token whose first check gets no clear answer (a 503) is caught by the second try", async () => {
    const sent = stubStore(failingFirst(1, json(503, { error: "Service Unavailable" }), FULL_ACCESS_STORE));
    const opened = await openStoreReader(FULL_ENV, NO_WAIT);
    expect(errorOf(opened)).toContain("can change the shared store");
    expect(commandNames(sent)).toEqual(["del", "del"]);
  });

  it.each([
    ["a 503", json(503, { error: "Service Unavailable" }), "UpstashError", 2],
    ["a 429", json(429, { error: "ERR max requests limit exceeded" }), "UpstashError", 2],
    ["a page that isn't JSON (a 502 from a proxy)", { status: 502, body: "<html>Bad gateway</html>" } as Reply, "UpstashJSONParseError", 2],
    // Only Upstash's own refusal counts, never a page that merely mentions permissions (review round 2, F2).
    ["a page that isn't JSON, even one that mentions permissions", { status: 403, body: "<html>You have no permission to access this resource</html>" } as Reply, "UpstashJSONParseError", 2],
    // The DEL is auto-pipelined, so a store's refusal of it comes as a per-command error in a 200 answer (review round 2, F1).
    ["a per-command error that isn't a permission refusal (a rate limit)", json(200, [{ error: "ERR max requests limit exceeded" }]), "UpstashError", 2],
    ["a read-only replica's refusal, which says nothing about the token", json(200, [{ error: "READONLY You can't write against a read only replica." }]), "UpstashError", 2],
    // A network failure is retried once by the SDK itself, so each check sends its DEL twice.
    ["no answer at all (a network failure)", "throw" as Reply, "TypeError", 4],
  ])("no clear answer twice (%s): it stops, says so by name, and reads nothing, whatever the token", async (_label, failure, name, requests) => {
    const sent = stubStore(failingFirst(Number.POSITIVE_INFINITY, failure, FULL_ACCESS_STORE));
    const opened = await openStoreReader(FULL_ENV, NO_WAIT);
    expect(errorOf(opened)).toContain(`Couldn't confirm that ${READONLY_STORE_TOKEN} is read-only (the store's check answered ${name}), so nothing was read.`);
    expect(commandNames(sent)).toEqual(Array.from({ length: requests }, () => "del"));
    expect(JSON.stringify(opened)).not.toContain(FULL_TOKEN);
  });

  it("a store that refuses the token itself (a 401): it stops at the check, names the two variables, and never quotes the store", async () => {
    const sent = stubStore(() => json(401, { error: "WRONGPASS invalid or missing auth token" }));
    const opened = await openStoreReader(READ_ONLY_ENV, NO_WAIT);
    const text = errorOf(opened);
    expect(text).toContain(`Couldn't confirm that ${READONLY_STORE_TOKEN} is read-only`);
    expect(text).toContain(READONLY_STORE_URL);
    expect(text).not.toContain("WRONGPASS");
    expect(text).not.toContain(READ_ONLY_TOKEN);
    expect(commandNames(sent)).toEqual(["del", "del"]);
  });

  it.each([
    ["a 503", json(503, { error: "Service Unavailable" }), 1],
    // The SDK retries a thrown fetch once itself, so the first check sends its DEL twice.
    ["a network failure", "throw" as Reply, 2],
  ])("a read-only token whose first check gets no clear answer (%s) opens on the second try, the retry's purpose", async (_label, failure, failed) => {
    const sent = stubStore(failingFirst(failed, failure, READ_ONLY_STORE));
    const opened = await openStoreReader(READ_ONLY_ENV, NO_WAIT);
    if (!("reader" in opened)) throw new Error(opened.error);
    expect(await opened.reader.mget("os:preview:a")).toEqual(["7"]);
    expect(commandNames(sent)).toEqual([...Array.from({ length: failed + 1 }, () => "del"), "mget"]);
  });

  it("waits a second before the second try by default", async () => {
    expect(STORE_CHECK_RETRY_MS).toBe(1_000);
    vi.useFakeTimers();
    try {
      const sent = stubStore(() => json(503, { error: "Service Unavailable" }));
      const opened = openStoreReader(READ_ONLY_ENV);
      await vi.advanceTimersByTimeAsync(STORE_CHECK_RETRY_MS - 1);
      expect(sent.length).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(errorOf(await opened)).toContain("Couldn't confirm");
      expect(sent.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits retryDelayMs before the second try when told to", async () => {
    stubStore(() => json(503, { error: "Service Unavailable" }));
    const started = Date.now();
    await openStoreReader(READ_ONLY_ENV, { retryDelayMs: 60 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it("the check's key is one nothing writes: outside every key prefix the app uses (a full-access token's DEL changes nothing)", () => {
    for (const scope of ["production", "preview", "development", "", "local", "readonly-check"]) {
      expect(READONLY_CHECK_KEY.startsWith(keyPrefix({ VERCEL_ENV: scope }))).toBe(false);
    }
    expect(READONLY_CHECK_KEY).not.toMatch(/^os:[a-z]+:/);
  });

  it("an address the SDK refuses: by the error's name only, never the address, and nothing is sent", async () => {
    const sent = stubStore(FULL_ACCESS_STORE);
    const opened = await openStoreReader({ ...READ_ONLY_ENV, [READONLY_STORE_URL]: "https://.made-up-host" }, NO_WAIT);
    expect(errorOf(opened)).toContain(`${READONLY_STORE_URL} can't be used (UrlError)`);
    expect(JSON.stringify(opened)).not.toContain("made-up-host");
    expect(sent).toEqual([]);
  });

  it("a connection string as the token sends nothing", async () => {
    const sent = stubStore(FULL_ACCESS_STORE);
    const opened = await openStoreReader({ ...READ_ONLY_ENV, [READONLY_STORE_TOKEN]: "rediss://default:MADE-UP-PASSWORD@db.upstash.invalid:6379" }, NO_WAIT);
    expect(errorOf(opened)).toContain(`${READONLY_STORE_TOKEN} holds a connection string`);
    expect(sent).toEqual([]);
  });
});

describe("storeFailureText", () => {
  it("a read the store refused: the error's name and where to look, never the store's words", () => {
    const err = Object.assign(new Error("WRONGPASS invalid or missing auth token, command was: [\"mget\",\"os:preview:a\"]"), { name: "UpstashError" });
    const text = storeFailureText("usage:report", err);
    expect(text).toContain("usage:report failed (UpstashError).");
    expect(text).toContain(READONLY_STORE_URL);
    expect(text).not.toContain("WRONGPASS");
    expect(text).not.toContain("os:preview");
  });

  it("other failures keep their name and no hint", () => {
    expect(storeFailureText("snapshot:pull", Object.assign(new Error("EACCES: data-local/x"), { name: "Error" }))).toBe("snapshot:pull failed (Error).");
  });
});

describe("nothing else reaches the store with these names or the app's client", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return d.name === "node_modules" ? [] : sources(p);
      return /\.(ts|tsx|js|mjs|cjs|json)$/.test(d.name) ? [p] : [];
    });

  it("the app never reads READONLY_STORE_URL or READONLY_STORE_TOKEN (src/, the Next and Vercel config)", () => {
    const files = [...sources(path.join(ROOT, "src")), path.join(ROOT, "next.config.ts"), path.join(ROOT, "vercel.json")];
    expect(files.length).toBeGreaterThan(100);
    const readers = files.filter((f) => /READONLY_STORE_(URL|TOKEN)/.test(readFileSync(f, "utf8")));
    // src/server/redis.test.ts names them on purpose, to show the app's client never takes them.
    expect(readers.map((f) => path.relative(ROOT, f).replaceAll("\\", "/"))).toEqual(["src/server/redis.test.ts"]);
  });

  it("no script builds the app's own client: the store-reading scripts use this reader, and the opt-in is gone", () => {
    const scripts = sources(path.join(ROOT, "scripts")).filter((f) => !/\.test\.ts$/.test(f));
    const offenders = scripts.filter((f) => /\bgetRedis(Clients)?\(|REDIS_OPT_IN_ENV|OFFERSHEET_REDIS/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
    for (const name of ["beta-log", "usage-report", "feedback-report", "snapshot-pull"]) {
      const text = readFileSync(path.join(ROOT, "scripts", `${name}.ts`), "utf8");
      expect(text).toContain("await openStoreReader(process.env)");
      expect(text).toContain("storeFailureText(");
    }
  });
});

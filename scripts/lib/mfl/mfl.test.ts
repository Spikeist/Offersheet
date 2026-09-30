import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpResult, RequestOptions } from "../http";
import { Redactor } from "../sanitize";
import { canonical } from "./canonical";
import { MflClient, cacheMflResponse, escapeCookieValue, mflLogin, nextMflUrl, type RequestFn } from "./client";
import { ageAt, compareWeekList, nextKickoffWeek, parseAddDrop, parseMflDate, parseTradeSide, returnWeek, seasonStart, txWeek, weekOf, type Kickoffs } from "./derive";
import { docHas, documentedTransTypes, htmlToText, typeAccess, typeBlock } from "./docs";
import { homeUrlPrefixes, pruneSanitized, synthesizeSearchSample, trimLeagueHistory } from "./fixture";
import { LEAGUE_HOST_PLACEHOLDER, redactFranchiseFields, redactUnknownLeagueFields, registerFreeText, registerLeagueHost, registerLeagueIdentities } from "./identities";
import { asArray, mflError, num, text } from "./json";
import { convertRosterLimits, convertStarters, parseLimit, type SlotDef } from "./lineup";
import { buildCrosswalk, median, projectionAgreement, runOracle } from "./oracle";
import { splitPositions, toInjury, toNflTeam, toPos } from "./positions";
import { compileFor, parsePoints, parseRange, parseRules, ruleValue, scoreStats, type MflRule } from "./rules";
import { candidateOrder, gamesPlayed, hostFromHomeUrl, parseSearch, rosterStatusCounts } from "./search";
import { addToWatchlist } from "./watchlist";

type RuleRow = [event: string, range: string, points: string, thresholdPoints?: string];
/** Build a TYPE=rules JSON body the way MFL shapes it ("$t" nodes, one-or-many). */
function rulesJson(groups: Array<{ positions: string; rules: RuleRow[] }>): unknown {
  return {
    rules: {
      positionRules: groups.map((g) => ({
        positions: g.positions,
        rule: g.rules.map(([event, range, points, t]) => ({ event: { $t: event }, range: { $t: range }, points: { $t: points }, ...(t ? { thresholdPoints: { $t: t } } : {}) })),
      })),
    },
  };
}
const compile = (groups: Array<{ positions: string; rules: RuleRow[] }>, pos: string) => compileFor(parseRules(rulesJson(groups)).rules, pos);

/** A fake HttpResult (only the fields the MFL client reads matter). */
function fakeRes(over: Partial<HttpResult>): HttpResult {
  return { url: "", finalUrl: "", status: 200, ok: true, contentType: "application/json", isHtml: false, text: "", json: undefined, headers: {}, elapsedMs: 0, fromCache: false, attempts: 1, ...over };
}

/** Deterministic PRNG for the property test (mulberry32). */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("MFL JSON helpers", () => {
  it("handles one-or-many and $t text nodes", () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray({ a: 1 })).toEqual([{ a: 1 }]);
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(text({ $t: "x" })).toBe("x");
    expect(num("1.5")).toBe(1.5);
    expect(num("")).toBeUndefined();
    expect(mflError({ error: { $t: "API requires logged in user" } })).toBe("API requires logged in user");
    expect(mflError({ league: {} })).toBeUndefined();
  });

  it("puts MFL JSON in canonical order but keeps meaningful array order", () => {
    const shuffled = {
      zeta: 1,
      alpha: { franchise: [{ name: "b", id: "0002" }, { id: "0001", name: "a" }] },
      leagueStandings: { franchise: [{ id: "0002" }, { id: "0001" }], column_names: { column: [{ id: "pf" }, { id: "h2hwlt" }] } },
      rules: { positionRules: [{ positions: "WR", rule: [{ event: { $t: "CY" }, range: { $t: "0-99" } }, { event: { $t: "CC" }, range: { $t: "0-99" } }] }, { positions: "QB" }] },
    };
    const c = canonical(shuffled) as typeof shuffled;
    expect(Object.keys(c)).toEqual(["alpha", "leagueStandings", "rules", "zeta"]);
    expect(c.alpha.franchise.map((f) => f.id)).toEqual(["0001", "0002"]);
    expect(Object.keys(c.alpha.franchise[0] as object)).toEqual(["id", "name"]);
    expect(c.leagueStandings.franchise.map((f) => f.id)).toEqual(["0002", "0001"]); // rank order kept
    expect(c.leagueStandings.column_names.column.map((f) => f.id)).toEqual(["pf", "h2hwlt"]); // documented column order kept
    expect(c.rules.positionRules.map((g) => g.positions)).toEqual(["QB", "WR"]);
    expect(c.rules.positionRules[1]?.rule?.map((r) => r.event.$t)).toEqual(["CC", "CY"]);
    // Equal keys: the order no longer depends on the input order.
    const tie = [{ id: "7", v: "b" }, { id: "7", v: "a" }];
    expect(canonical(tie)).toEqual(canonical([...tie].reverse()));
  });
});

describe("MFL client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("templates URLs without league ids, player ids or search terms", () => {
    const c = new MflClient(2026);
    expect(c.url("rules", { L: "12345" }, "wwwtest.myfantasyleague.com")).toBe("https://wwwtest.myfantasyleague.com/2026/export?TYPE=rules&L=12345&JSON=1");
    expect(c.template("players", { L: "12345", PLAYERS: "0800,0801" }, "wwwtest.myfantasyleague.com")).toBe("https://{leagueHost}/2026/export?TYPE=players&L={leagueId}&PLAYERS={playerIds}&JSON=1");
    expect(c.template("leagueSearch", { SEARCH: "zorblax" })).toBe("https://api.myfantasyleague.com/2026/export?TYPE=leagueSearch&SEARCH={term}&JSON=1");
  });

  it("escapes the Base64 cookie symbols the docs name, and only those", () => {
    expect(escapeCookieValue("ab+c/d==")).toBe("ab%2Bc%2Fd%3D%3D");
    expect(escapeCookieValue("abc%2B")).toBe("abc%2B");
  });

  it("logs in by POST, returns the escaped cookie and never follows a redirect with the password", async () => {
    const seen: Array<{ url: string; opts: RequestOptions }> = [];
    const req: RequestFn = async (url, opts) => {
      seen.push({ url, opts });
      return fakeRes({ text: '<status MFL_USER_ID="Zm9v+YmFy/cXV4=">OK</status>' });
    };
    await expect(mflLogin(2026, "zorblax", "not-a-real-password", req)).resolves.toBe("MFL_USER_ID=Zm9v%2BYmFy%2FcXV4%3D");
    expect(seen[0]?.url).toBe("https://api.myfantasyleague.com/2026/login");
    expect(seen[0]?.opts).toMatchObject({ method: "POST", redirect: "manual", retries: 0 });
    const bad: RequestFn = async () => fakeRes({ status: 200, text: "<error>Invalid</error>" });
    await expect(mflLogin(2026, "zorblax", "wrong", bad)).rejects.toThrow(/MFL login failed/);
  });

  it("follows a cross-host redirect by hand and re-attaches the cookie", async () => {
    const seen: Array<{ url: string; cookie?: string; redirect?: string; retries?: number }> = [];
    const req: RequestFn = async (url, opts) => {
      seen.push({ url, cookie: opts.cookie, redirect: opts.redirect, retries: opts.retries });
      if (url.startsWith("https://api.")) return fakeRes({ status: 302, ok: false, headers: { location: "https://wwwtest.myfantasyleague.com/2026/export?TYPE=league&L=54321&JSON=1" } });
      return fakeRes({ json: { league: { name: "Private", franchises: { franchise: [{ id: "0001", owner_name: "Zorblax" }] } } } });
    };
    const c = new MflClient(2026, "cred-test", "MFL_USER_ID=abc%3D", { request: req, cache: false });
    c.leagueHost = "wwwtest.myfantasyleague.com";
    const call = await c.export("league", { L: "54321" }, { ttlMs: 1, namespace: "t", label: "league" });
    expect(seen.map((s) => [s.url.split("/")[2], s.cookie, s.redirect, s.retries])).toEqual([
      ["api.myfantasyleague.com", "MFL_USER_ID=abc%3D", "manual", 0],
      ["wwwtest.myfantasyleague.com", "MFL_USER_ID=abc%3D", "manual", 0],
    ]);
    expect(call.redirects).toEqual([{ status: 302, from: "api.myfantasyleague.com", to: "{leagueHost}" }]);
    expect(call.error).toBeUndefined();
    expect(c.log.map((e) => e.kind)).toEqual(["export", "redirect"]);
  });

  it("refuses redirects that would carry the cookie off MFL or over http, and caps the hops", async () => {
    expect(nextMflUrl("https://api.myfantasyleague.com/2026/export?x", "https://evil.example.com/steal")).toBeUndefined();
    expect(nextMflUrl("https://api.myfantasyleague.com/2026/export?x", "https://myfantasyleague.com.evil.example/x")).toBeUndefined();
    expect(nextMflUrl("https://api.myfantasyleague.com/2026/export?x", "ftp://wwwtest.myfantasyleague.com/x")).toBeUndefined();
    expect(nextMflUrl("https://api.myfantasyleague.com/2026/export?x", "http://wwwtest.myfantasyleague.com/2026/export?y")).toBe("https://wwwtest.myfantasyleague.com/2026/export?y");
    expect(nextMflUrl("https://wwwtest.myfantasyleague.com/2026/a", "/2026/b?c=1")).toBe("https://wwwtest.myfantasyleague.com/2026/b?c=1");
    const offsite: RequestFn = async () => fakeRes({ status: 302, ok: false, headers: { location: "https://evil.example.com/" } });
    const c1 = new MflClient(2026, "cred-test", "MFL_USER_ID=x", { request: offsite, cache: false });
    const refused = await c1.export("league", { L: "54321" }, { ttlMs: 1, namespace: "t", label: "league" });
    expect(refused.error).toMatch(/refused/);
    expect(c1.log).toHaveLength(1);
    const loop: RequestFn = async (url) => fakeRes({ status: 301, ok: false, headers: { location: url.includes("wwwtest") ? "https://wwwalt.myfantasyleague.com/a" : "https://wwwtest.myfantasyleague.com/a" } });
    const c2 = new MflClient(2026, "public", undefined, { request: loop, cache: false });
    const looped = await c2.export("league", { L: "54321" }, { ttlMs: 1, namespace: "t", label: "league" });
    expect(looped.error).toBe("too many redirects");
    expect(c2.log.length).toBeLessThanOrEqual(5);
  });

  it("never caches MFL error bodies or HTML, but caches data and redirects", () => {
    expect(cacheMflResponse(fakeRes({ json: { league: {} } }))).toBe(true);
    expect(cacheMflResponse(fakeRes({ json: { error: { $t: "API requires logged in user" } } }))).toBe(false);
    expect(cacheMflResponse(fakeRes({ isHtml: true, json: undefined }))).toBe(false);
    expect(cacheMflResponse(fakeRes({ status: 302, headers: { location: "https://wwwtest.myfantasyleague.com/x" } }))).toBe(true);
    expect(cacheMflResponse(fakeRes({ status: 500 }))).toBe(false);
  });

  it("stops after a 429 for the rest of the run", async () => {
    const req: RequestFn = async () => fakeRes({ status: 429, ok: false });
    const c = new MflClient(2026, "public", undefined, { request: req, cache: false });
    await c.export("rules", { L: "54321" }, { ttlMs: 1, namespace: "t", label: "rules" });
    expect(c.throttled).toBe(true);
    await expect(c.export("rosters", { L: "54321" }, { ttlMs: 1, namespace: "t", label: "rosters" })).rejects.toThrow(/429/);
  });

  it("sends the cookie through lib/http with redirect: manual on both hops (mocked fetch)", { timeout: 15_000 }, async () => {
    const hits: Array<{ host: string; cookie: string | null; redirect: RequestRedirect | undefined }> = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      hits.push({ host: url.host, cookie: headers.get("cookie"), redirect: init?.redirect });
      if (url.host === "api.myfantasyleague.com") return new Response(null, { status: 302, headers: { location: "https://wwwtest.myfantasyleague.com/2026/export?TYPE=league&L=54321&JSON=1" } });
      return new Response(JSON.stringify({ league: { id: "54321" } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const c = new MflClient(2026, "cred-test", "MFL_USER_ID=abc%2B", { cache: false });
    const call = await c.export("league", { L: "54321" }, { ttlMs: 1, namespace: "t", label: "league (mocked)" });
    expect(hits).toEqual([
      { host: "api.myfantasyleague.com", cookie: "MFL_USER_ID=abc%2B", redirect: "manual" },
      { host: "wwwtest.myfantasyleague.com", cookie: "MFL_USER_ID=abc%2B", redirect: "manual" },
    ]);
    expect(call.json).toEqual({ league: { id: "54321" } });
    expect(call.redirects).toHaveLength(1);
  });
});

describe("leagueSearch helpers", () => {
  it("parses the colon-less homeURL", () => {
    expect(hostFromHomeUrl("https//wwwtest.myfantasyleague.com/2026/home/12345")).toBe("wwwtest.myfantasyleague.com");
    expect(hostFromHomeUrl("https://wwwtest.myfantasyleague.com/2026/home/12345")).toBe("wwwtest.myfantasyleague.com");
    expect(hostFromHomeUrl("https//example.com/x")).toBeUndefined();
  });

  it("orders superflex-named hits by a salted hash: stable per salt, different across salts", () => {
    const league = Array.from({ length: 40 }, (_, i) => ({ id: String(20000 + i), name: i % 2 ? `Quuxwell SF Dynasty ${i}` : `Plain League ${i}`, homeURL: `https//wwwone.myfantasyleague.com/2026/home/${20000 + i}` }));
    const hits = parseSearch({ leagues: { league } });
    expect(hits).toHaveLength(40);
    const a = candidateOrder(hits, "salt-a").map((h) => h.id);
    expect(a).toHaveLength(20);
    expect(a.every((id) => Number(id) % 2 === 1)).toBe(true);
    expect(candidateOrder([...hits].reverse(), "salt-a").map((h) => h.id)).toEqual(a);
    expect(candidateOrder(hits, "salt-b").map((h) => h.id)).not.toEqual(a);
    expect(() => candidateOrder(hits, "")).toThrow(/salt/);
  });

  it("counts games and roster statuses", () => {
    expect(gamesPlayed({ leagueStandings: { franchise: [{ h2hw: "2", h2hl: "1", h2ht: "0" }, { h2hw: "1", h2hl: "2", h2ht: "0" }] } })).toBe(6);
    expect(rosterStatusCounts({ rosters: { franchise: [{ player: [{ id: "1", status: "ROSTER" }, { id: "2", status: "TAXI_SQUAD" }] }, { player: { id: "3", status: "ROSTER" } }] } })).toEqual({ ROSTER: 2, TAXI_SQUAD: 1 });
  });
});

describe("positions", () => {
  it("maps MFL codes to the model", () => {
    expect(toPos("PK")).toBe("K");
    expect(toPos("DT")).toBe("DL");
    expect(toPos("S")).toBe("DB");
    expect(toPos("PN")).toBeUndefined();
    expect(toNflTeam("KCC")).toBe("KC");
    expect(toNflTeam("JAC")).toBe("JAX");
    expect(toNflTeam("FA")).toBeNull();
    expect(toNflTeam("XXX")).toBeUndefined();
    expect(toInjury("IR-PUP")).toBe("PUP");
    expect(toInjury("IR-R")).toBe("IR");
    expect(toInjury("Questionable")).toBe("QUESTIONABLE");
    expect(toInjury("Holdout")).toBe("NA");
    expect(toInjury(undefined)).toBe("ACTIVE");
    expect(splitPositions("DT+DE")).toEqual(["DT", "DE"]);
    expect(splitPositions("QB|RB|WR|TE")).toEqual(["QB", "RB", "WR", "TE"]);
  });
});

describe("lineup conversion", () => {
  const OFF = ["QB", "RB", "WR", "TE"] as const;
  const key = (v: number[]) => v.join(",");
  /** Every legal starter count vector (QB, RB, WR, TE) for the ranges and the starter total. */
  function legal(ranges: Array<{ min: number; max: number }>, count: number): Set<string> {
    const out = new Set<string>();
    const rec = (i: number, acc: number[]) => {
      if (i === ranges.length) {
        if (acc.reduce((s, x) => s + x, 0) === count) out.add(key(acc));
        return;
      }
      const r = ranges[i] as { min: number; max: number };
      for (let v = r.min; v <= r.max; v++) rec(i + 1, [...acc, v]);
    };
    rec(0, []);
    return out;
  }
  /** Every count vector the SlotDefs can produce (each slot's count spread over its eligible positions). */
  function achievable(lineup: SlotDef[]): Set<string> {
    const out = new Set<string>();
    const rec = (i: number, acc: number[]) => {
      if (i === lineup.length) {
        out.add(key(acc));
        return;
      }
      const slot = lineup[i] as SlotDef;
      const idx = slot.eligible.map((p) => OFF.indexOf(p as (typeof OFF)[number])).filter((j) => j >= 0);
      const spread = (k: number, left: number, cur: number[]) => {
        if (k === idx.length - 1) {
          const next = [...cur];
          next[idx[k] as number] = (next[idx[k] as number] as number) + left;
          rec(i + 1, next);
          return;
        }
        for (let v = 0; v <= left; v++) {
          const next = [...cur];
          next[idx[k] as number] = (next[idx[k] as number] as number) + v;
          spread(k + 1, left - v, next);
        }
      };
      if (!idx.length) rec(i + 1, acc);
      else spread(0, slot.count, acc);
    };
    rec(0, [0, 0, 0, 0]);
    return out;
  }

  it("converts one binding cap exactly (QB 1-2 → one SUPER_FLEX + FLEX)", () => {
    const c = convertStarters({ count: "10", position: [{ name: "QB", limit: "1-2" }, { name: "RB", limit: "2-5" }, { name: "WR", limit: "3-6" }, { name: "TE", limit: "1-4" }] });
    expect(c.exact).toBe(true);
    expect(c.lineup).toEqual([
      { slot: "QB", count: 1, eligible: ["QB"] },
      { slot: "RB", count: 2, eligible: ["RB"] },
      { slot: "WR", count: 3, eligible: ["WR"] },
      { slot: "TE", count: 1, eligible: ["TE"] },
      { slot: "SUPER_FLEX", count: 1, eligible: ["QB", "RB", "WR", "TE"] },
      { slot: "FLEX", count: 2, eligible: ["RB", "WR", "TE"] },
    ]);
  });

  it("converts several binding caps exactly when their rooms fit in the flex spots", () => {
    // QB 1-2 and TE 1-2 each bind (1 extra < 2 flex); RB/WR are free: {QB,RB,WR}×1 + {RB,WR,TE}×1.
    const c = convertStarters({ count: "8", position: [{ name: "QB", limit: "1-2" }, { name: "RB", limit: "2-4" }, { name: "WR", limit: "2-4" }, { name: "TE", limit: "1-2" }] });
    expect(c.exact).toBe(true);
    expect(c.lineup.filter((s) => s.eligible.length > 1)).toEqual([
      { slot: "FLEX(QB/RB/WR)", count: 1, eligible: ["QB", "RB", "WR"] },
      { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
    ]);
    expect(achievable(c.lineup)).toEqual(legal([{ min: 1, max: 2 }, { min: 2, max: 4 }, { min: 2, max: 4 }, { min: 1, max: 2 }], 8));
  });

  it("flags several binding caps whose rooms exceed the flex spots, and splits IDP starters", () => {
    const c = convertStarters({
      count: "14",
      idp_starters: "5",
      position: [
        { name: "QB", limit: "1-2" },
        { name: "RB", limit: "0-4" },
        { name: "WR", limit: "0-5" },
        { name: "TE", limit: "1-3" },
        { name: "PK", limit: "1" },
        { name: "DT+DE", limit: "1-3" },
        { name: "LB", limit: "1-3" },
        { name: "CB+S", limit: "1-3" },
      ],
    });
    expect(c.exact).toBe(false);
    expect(c.lineup).toContainEqual({ slot: "SUPER_FLEX", count: 6, eligible: ["QB", "RB", "WR", "TE"] });
    expect(c.lineup).toContainEqual({ slot: "IDP_FLEX", count: 2, eligible: ["DL", "LB", "DB"] });
    expect(c.starterCaps).toMatchObject({ QB: 2, RB: 4, WR: 5, TE: 3, K: 1, DL: 3, LB: 3, DB: 3 });
    expect(c.pools.map((p) => [p.pool, p.count, p.flex])).toEqual([
      ["offense", 9, 6],
      ["idp", 5, 2],
    ]);
  });

  it("matches brute force on random ranges (exact: same lineups; inexact: SlotDefs ∩ caps)", () => {
    const rnd = prng(20260929);
    let exact = 0;
    for (let t = 0; t < 300; t++) {
      const ranges = OFF.map(() => {
        const min = Math.floor(rnd() * 3);
        return { min, max: min + Math.floor(rnd() * 5) };
      });
      const mins = ranges.reduce((s, r) => s + r.min, 0);
      const count = mins + Math.floor(rnd() * 7);
      const conv = convertStarters({ count: String(count), position: OFF.map((name, i) => ({ name, limit: `${ranges[i]?.min}-${ranges[i]?.max}` })) });
      const want = legal(ranges, count);
      const got = achievable(conv.lineup);
      if (conv.exact) {
        exact++;
        expect([...got].sort()).toEqual([...want].sort());
      } else {
        // Inexact (or infeasible: the ranges can't reach the starter total) → the solver adds the caps
        // and the starter total; together with the SlotDefs they must give exactly the legal lineups.
        const caps = OFF.map((p) => conv.starterCaps[p] ?? 0);
        const capped = [...got].filter((k) => k.split(",").every((v, i) => Number(v) <= (caps[i] as number)) && k.split(",").reduce((s, v) => s + Number(v), 0) === count);
        expect(capped.sort()).toEqual([...want].sort());
      }
    }
    expect(exact).toBeGreaterThan(100);
  });

  it("handles fixed lineups, unsupported positions, shared model positions and roster limits", () => {
    const fixed = convertStarters({ count: "9", position: [{ name: "QB", limit: "1" }, { name: "RB", limit: "2-3" }, { name: "WR", limit: "3-4" }, { name: "TE", limit: "1-2" }, { name: "PK", limit: "1" }, { name: "Def", limit: "1" }] });
    expect(fixed.exact).toBe(true);
    expect(fixed.lineup.reduce((s, x) => s + x.count, 0)).toBe(9);
    const odd = convertStarters({ count: "2", position: [{ name: "QB", limit: "1" }, { name: "Coach", limit: "1" }] });
    expect(odd.unsupported).toEqual(["Coach 1"]);
    expect(odd.exact).toBe(false);
    const split = convertStarters({ count: "3", position: [{ name: "DT", limit: "1-2" }, { name: "DE", limit: "1-2" }] });
    expect(split.exact).toBe(false);
    expect(split.notes.join(" ")).toMatch(/DT and DE both map to DL/);
    expect(parseLimit("3")).toEqual({ min: 3, max: 3 });
    expect(parseLimit("3-1")).toBeUndefined();
    expect(convertRosterLimits({ position: [{ name: "QB", limit: "1-25" }, { name: "DT+DE", limit: "0-10" }] })).toEqual({ max: { QB: 25, DL: 10 }, min: { QB: 1, DL: 0 }, unsupported: [] });
  });
});

describe("scoring rules", () => {
  it("parses ranges and the four points formats", () => {
    expect(parseRange("-50-999")).toEqual({ lo: -50, hi: 999 });
    expect(parseRange("0.5-20.0")).toEqual({ lo: 0.5, hi: 20 });
    expect(parsePoints("*.04")).toEqual({ kind: "each", n: 0.04 });
    expect(parsePoints("*-4")).toEqual({ kind: "each", n: -4 });
    expect(parsePoints("1/10")).toEqual({ kind: "every", a: 1, b: 10 });
    expect(parsePoints("-1/49", "-1")).toEqual({ kind: "formula", threshold: -1, a: -1, b: 49 });
    expect(parsePoints("6")).toEqual({ kind: "flat", n: 6 });
    expect(parsePoints("abc")).toEqual({ kind: "unknown" });
  });

  it("evaluates MFL semantics: per unit, stepped, flat in range, formula", () => {
    const r = (points: string, range: string, t?: string): MflRule => ({ group: 0, positions: ["RB"], event: "RY", ...parseRange(range)!, rangeRaw: range, pointsRaw: points, points: parsePoints(points, t), extra: {} });
    expect(ruleValue(r("*0.1", "-50-999"), 128)).toBeCloseTo(12.8);
    expect(ruleValue(r("1/10", "1-999"), 128)).toBe(12); // "1 point for every 10 yards" is stepped
    expect(ruleValue(r("5", "100-999"), 99)).toBe(0);
    expect(ruleValue(r("5", "100-999"), 100)).toBe(5);
    expect(ruleValue(r("2/25", "250-999", "10"), 300)).toBe(14); // 10 for reaching 250, 2 per 25 beyond
  });

  it("adds rules from overlapping position groups (TE premium)", () => {
    const groups = [
      { positions: "QB|RB|WR|TE", rules: [["CC", "0-99", "*1"]] as RuleRow[] },
      { positions: "TE", rules: [["CC", "0-99", "*1"]] as RuleRow[] },
    ];
    expect(compile(groups, "TE").rates.rec).toBe(2);
    expect(compile(groups, "WR").rates.rec).toBe(1);
  });

  it("maps TD length rules onto Sleeper's TD and 40+/50+ keys", () => {
    expect(compile([{ positions: "QB", rules: [["PS", "1-110", "6"]] }], "QB").rates).toEqual({ pass_td: 6 });
    expect(compile([{ positions: "QB", rules: [["PS", "1-39", "4"], ["PS", "40-110", "6"]] }], "QB").rates).toEqual({ pass_td: 4, pass_td_40p: 2 });
    expect(compile([{ positions: "WR", rules: [["RC", "1-39", "6"], ["RC", "40-49", "7"], ["RC", "50-99", "8"]] }], "WR").rates).toEqual({ rec_td: 6, rec_td_40p: 1, rec_td_50p: 1 });
    expect(compile([{ positions: "WR", rules: [["RC", "1-45", "6"], ["RC", "46-99", "8"]] }], "WR").unmapped).toHaveLength(2);
  });

  it("maps field goals by distance bucket, per yard, and the formula missed-FG rule", () => {
    const pk = compile([{ positions: "PK", rules: [["FG", "17-39", "3"], ["FG", "40-49", "4"], ["FG", "50-110", "5"]] }], "PK");
    expect(pk.rates).toEqual({ fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5 });
    expect(compile([{ positions: "PK", rules: [["FG", "0-99", "*0.1"]] }], "PK").rates).toEqual({ fgm_yds: 0.1 });
    const mg = compile([{ positions: "PK", rules: [["MG", "17-49", "-1/49", "-1"], ["MG", "50-110", "0"]] }], "PK");
    expect(mg.rates).toEqual({ fgmiss_0_19: -1, fgmiss_20_29: -1, fgmiss_30_39: -1, fgmiss_40_49: -1 });
    expect(mg.unmapped).toEqual([]);
  });

  it("keeps half-sack steps exact, turns flat bands into bonuses, and rejects tiered rates", () => {
    const lb = compile([{ positions: "LB", rules: [["SK", "0.5-20.0", "1/0.5"]] }], "LB");
    expect(lb.rates).toEqual({ idp_sack: 2 });
    expect(lb.approx).toEqual([]);
    const rb = compile([{ positions: "RB", rules: [["RY", "-50-999", "*0.1"], ["RY", "100-199", "3"], ["RY", "200-999", "5"]] }], "RB");
    expect(rb.rates).toEqual({ rush_yd: 0.1 });
    expect(rb.bonuses).toEqual([
      { stat: "rush_yd", threshold: 100, points: 3 },
      { stat: "rush_yd", threshold: 200, points: 2 },
    ]);
    expect(scoreStats(rb, { rush_yd: 150 })).toBeCloseTo(18);
    expect(scoreStats(rb, { rush_yd: 250 })).toBeCloseTo(30); // bands don't stack on MFL: 25 + 5
    const tiered = compile([{ positions: "RB", rules: [["RY", "0-99", "*0.1"], ["RY", "100-999", "*0.2"]] }], "RB");
    expect(tiered.unmapped).toHaveLength(2);
    const stepped = compile([{ positions: "RB", rules: [["RY", "1-999", "1/10"]] }], "RB");
    expect(stepped.rates).toEqual({ rush_yd: 0.1 });
    expect(stepped.approx[0]?.note).toMatch(/stepped/);
  });

  it("does not double-count Sleeper keys that merge several MFL events", () => {
    expect(compile([{ positions: "LB", rules: [["#IR", "0-10", "*6"], ["#DR", "0-10", "*6"], ["BF", "1-110", "6"]] }], "LB").rates).toEqual({ idp_def_td: 6 });
    const diff = compile([{ positions: "LB", rules: [["#IR", "0-10", "*6"], ["#DR", "0-10", "*4"]] }], "LB");
    expect(diff.rates).toEqual({ idp_def_td: 6 });
    expect(diff.approx).toHaveLength(1);
    const agg = compile([{ positions: "LB", rules: [["#D", "0-10", "*6"], ["#IR", "0-10", "*2"]] }], "LB");
    expect(agg.rates).toEqual({ idp_def_td: 8 });
    expect(agg.approx).toHaveLength(1);
    expect(compile([{ positions: "LB", rules: [["BLF", "1-99", "*2"], ["BLP", "1-99", "*2"], ["BLE", "1-99", "*2"]] }], "LB").rates).toEqual({ idp_blk_kick: 2 });
  });

  it("maps points allowed to Sleeper buckets and reports unknown or conditional rules", () => {
    const def = compile([{ positions: "Def", rules: [["TPA", "0-0", "10"], ["TPA", "1-6", "7"], ["TPA", "7-13", "4"], ["TPA", "14-20", "1"], ["TPA", "21-27", "0"], ["TPA", "28-34", "-1"], ["TPA", "35-99", "-4"]] }], "Def");
    expect(def.rates).toEqual({ pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_28_34: -1, pts_allow_35p: -4 });
    expect(compile([{ positions: "QB", rules: [["RATE", "0-158", "*0.1"]] }], "QB").unmapped[0]?.note).toMatch(/no Sleeper stat key/);
    const parsed = parseRules({ rules: { positionRules: { positions: "QB", rule: { event: { $t: "PY" }, range: { $t: "0-999" }, points: { $t: "*.04" }, conditionalEvent: { $t: "PA" } } } } });
    expect(parsed.rules).toHaveLength(1); // single group and single rule arrive as objects
    expect(compileFor(parsed.rules, "QB").unmapped[0]?.note).toMatch(/conditional/);
  });
});

describe("derivations", () => {
  const kick: Kickoffs = new Map([
    [1, [1_000_000, 1_100_000]],
    [2, [1_600_000, 1_700_000]],
  ]);
  it("assigns moves to the week they can first affect", () => {
    expect(weekOf(900_000, kick)).toBe(1);
    expect(weekOf(1_100_000 + 3600, kick)).toBe(1); // during Monday's game
    expect(weekOf(1_200_000, kick)).toBe(2);
    expect(weekOf(2_000_000, kick)).toBeUndefined();
  });

  it("files moves under the next week to kick off, as MFL's W= filter does, with preseason kept apart", () => {
    expect(seasonStart(kick)).toBe(1_000_000);
    expect(nextKickoffWeek(900_000, kick)).toBe(1); // MFL files preseason moves under W=1…
    expect(txWeek(900_000, kick)).toBe(0); // …activity counts keep them apart
    expect(nextKickoffWeek(1_000_000, kick)).toBe(2); // at/after week 1's first kickoff → week 2
    expect(txWeek(1_050_000, kick)).toBe(2); // during week 1's games (weekOf would say 1)
    expect(weekOf(1_050_000, kick)).toBe(1);
    expect(txWeek(1_599_999, kick)).toBe(2);
    expect(txWeek(1_650_000, kick)).toBeUndefined(); // after the last week kicked off
    expect(txWeek(5, new Map())).toBeUndefined();
  });

  it("compares MFL's W= list with the derived weeks as multisets", () => {
    const t = (id: string, ts: number) => ({ type: "FREE_AGENT", franchise: id, timestamp: String(ts) });
    const all = [t("0001", 900_000), t("0002", 1_200_000), t("0002", 1_200_000), t("0003", 1_050_000), t("0004", 1_650_000)];
    const week = (x: { timestamp: string }) => nextKickoffWeek(Number(x.timestamp), kick);
    const same = compareWeekList(all, [t("0002", 1_200_000), t("0002", 1_200_000), t("0003", 1_050_000)], 2, week);
    expect(same).toEqual({ mfl: 3, ours: 3, both: 3, onlyMflByOurWeek: {}, onlyOurs: 0 });
    const shifted = compareWeekList(all, [t("0001", 900_000), t("0002", 1_200_000), t("0009", 1_300_000)], 2, week);
    expect(shifted).toEqual({ mfl: 3, ours: 3, both: 1, onlyMflByOurWeek: { "1": 1, "not in the full list": 1 }, onlyOurs: 2 });
  });

  it("parses trade sides and add/drop strings", () => {
    expect(parseTradeSide("15714,FP_0005_2027_2,DP_02_05,BB_10,XYZ,")).toEqual({ players: ["15714"], futurePicks: [{ originalFranchise: "0005", year: 2027, round: 2 }], currentPicks: [{ round: 3, pick: 6 }], blindBid: 10, unknown: ["XYZ"] });
    expect(parseAddDrop("12345,|23456,")).toEqual({ added: ["12345"], dropped: ["23456"] });
    expect(parseAddDrop("12345,|4.00|23456,")).toEqual({ added: ["12345"], bid: 4, dropped: ["23456"] });
  });

  it("turns exp_return dates into weeks and birthdates into ages", () => {
    expect(parseMflDate("Oct 4, 2026")).toBe(Date.UTC(2026, 9, 4, 12) / 1000);
    expect(parseMflDate("soon")).toBeUndefined();
    const k2: Kickoffs = new Map([
      [4, [Date.UTC(2026, 9, 1) / 1000, Date.UTC(2026, 9, 5) / 1000]],
      [5, [Date.UTC(2026, 9, 8) / 1000, Date.UTC(2026, 9, 12) / 1000]],
    ]);
    expect(returnWeek("Oct 4, 2026", k2)).toBe(4);
    expect(returnWeek("Oct 7, 2026", k2)).toBe(5);
    expect(ageAt("916635600", Date.UTC(2026, 8, 29) / 1000)).toBe(27);
    expect(ageAt("", 0)).toBeUndefined();
  });
});

describe("crosswalk, oracle and projection agreement", () => {
  it("uses DynastyProcess first, then ID joins, and records agreement", () => {
    const xw = buildCrosswalk(
      [
        { id: "13604", espn_id: "3139477" },
        { id: "16000", rotowire_id: "123" },
      ],
      [{ mfl_id: "13604", sleeper_id: "4046" }],
      [
        { player_id: "4046", espn_id: "3139477" },
        { player_id: "777", rotowire_id: 123 },
      ],
    );
    expect(xw.sleeperOf.get("13604")).toEqual({ sleeperId: "4046", via: "dynastyprocess" });
    expect(xw.sleeperOf.get("16000")).toEqual({ sleeperId: "777", via: "rotowire_id" });
    expect(xw.agreement.espn_id).toEqual({ agree: 1, disagree: 0 });
  });

  it("compares within 0.05 and leaves out player-weeks that are 0 on both sides", () => {
    const compiled = new Map([["WR", compile([{ positions: "WR", rules: [["CC", "0-99", "*1"], ["CY", "-50-999", "*0.1"]] }], "WR")]]);
    const xwalk = buildCrosswalk([{ id: "1001" }, { id: "1002" }, { id: "1003" }], [{ mfl_id: "1001", sleeper_id: "s1" }, { mfl_id: "1002", sleeper_id: "s2" }, { mfl_id: "1003", sleeper_id: "s3" }], []);
    const { result } = runOracle({
      weeks: [3],
      players: ["1001", "1002", "1003"].map((mflId) => ({ mflId, mflPos: "WR" })),
      mflScores: new Map([[3, new Map([["1001", 15.4], ["1002", 9]])]]),
      sleeperStats: new Map([[3, new Map([["s1", { rec: 5, rec_yd: 104 }], ["s2", { rec: 2, rec_yd: 30 }]])]]),
      compiled,
      xwalk,
    });
    expect(result.compared).toBe(2);
    expect(result.within).toBe(1);
    expect(result.skipped.bothZero).toBe(1);
    expect(result.worst[0]).toMatchObject({ mflId: "1002", mfl: 9, ours: 5 });
  });

  it("summarizes MFL vs Sleeper×rules projections per position (§6 40% rule)", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    const ag = projectionAgreement([
      { mflId: "1", mflPos: "WR", mfl: 8, ours: 10, halfPpr: 10 },
      { mflId: "2", mflPos: "WR", mfl: 5, ours: 10, halfPpr: 10 }, // 0.5 → disagrees by > 40%
      { mflId: "3", mflPos: "TE", mfl: 9, ours: 10, halfPpr: 8 },
      { mflId: "4", mflPos: "TE", mfl: 2, ours: 10 }, // ≤ 3 points on the MFL side → left out
    ]);
    expect(ag.overall).toMatchObject({ n: 3, medianRatio: 0.8, disagree: 1 });
    expect(ag.byPos.WR).toMatchObject({ n: 2, medianRatio: 0.65, disagree: 1, medianHalfPpr: 0.65 });
    expect(ag.byPos.TE).toMatchObject({ n: 1, medianRatio: 0.9, medianHalfPpr: 1.125 });
  });
});

describe("identities and fixture shaping", () => {
  it("registers franchise identities, past league ids and free text, but never a season year", () => {
    const r = new Redactor("mfl-test");
    const league = {
      league: {
        id: "54321",
        name: "Quuxwell Gridiron Consortium",
        baseURL: "https://wwwtest.myfantasyleague.com",
        history: { league: [{ year: "2025", url: "https://wwwtest.myfantasyleague.com/2025/home/65432" }] },
        divisions: { division: [{ id: "00", name: "Blorptown Division" }] },
        franchises: { franchise: [{ id: "0003", name: "Zorblax Rockets", abbrev: "ZRK", icon: "https://example.com/i.png", stadium: "The Glorbodrome", owner_name: "Zorblax Quintavious", email: "zq@example.com", bbidAvailableBalance: "100.00", division: "00" }] },
      },
    };
    const ids = registerLeagueIdentities(r, league);
    expect(ids).toEqual(["0003"]);
    registerFreeText(r, { draftResults: { draftUnit: { static_url: "https://wwwtest.myfantasyleague.com/fflnetdynamic2026/54321_LEAGUE_draft_results.xml", draftPick: [{ comments: "steal of the draft" }] } } });
    const clean = r.apply(league);
    expect(clean.league.name).toBe("League 1");
    expect(clean.league.franchises.franchise[0]).toMatchObject({ name: "Team 3", abbrev: "T3", owner_name: "Owner 3", stadium: "[stadium 3]", bbidAvailableBalance: "100.00" });
    expect(JSON.stringify(clean)).not.toMatch(/54321|65432|Zorblax|Glorbodrome|Blorptown|example\.com\/i/);
    expect(r.placeholderOf("2025")).toBeUndefined();
    expect(r.placeholderOf("steal of the draft")).toBeDefined();
    expect(r.findLeaks(clean)).toEqual([]);
  });

  it("replaces unknown franchise fields by path, numeric or not, without registering short numbers", () => {
    const r = new Redactor("mfl-test");
    const league = { league: { id: "54321", franchises: { franchise: [{ id: "0003", name: "Zorblax Rockets", zip: "10001", phone: "555-867-5309", cell: "5558675309", account: "4242", lastVisit: "1790000000", waiverSortOrder: "3" }] } } };
    registerLeagueIdentities(r, league);
    const shaped = redactFranchiseFields(league);
    expect(shaped.keys).toEqual(["account", "cell", "phone", "zip"]);
    const clean = r.apply(shaped.json) as typeof league;
    expect(clean.league.franchises.franchise[0]).toEqual({ id: "0003", name: "Team 3", zip: "[zip 3]", phone: "[phone 3]", cell: "[cell 3]", account: "[account 3]", lastVisit: "1790000000", waiverSortOrder: "3" });
    // A 5-digit ZIP is not registered: MFL player ids are 4–5 digit strings and would be hit.
    expect(r.placeholderOf("10001")).toBeUndefined();
    expect(r.placeholderOf("4242")).toBeUndefined();
    expect(r.placeholderOf("5558675309")).toBe("[cell 3]");
    expect(r.apply({ note: "call 555-867-5309" })).toEqual({ note: "call [phone 3]" });
  });

  it("with a login, replaces unknown league-level fields by path and registers their text", () => {
    const r = new Redactor("mfl-test");
    const league = { league: { id: "54321", survivorPool: "Yes", commissionerNote: "ask Zorblax Quintavious", secretCode: "777", extra: { contact: "zq@example.invalid" } } };
    const out = redactUnknownLeagueFields(r, league);
    expect(out.keys).toEqual(["commissionerNote", "extra", "secretCode"]);
    expect(out.json).toEqual({ league: { id: "54321", survivorPool: "Yes", commissionerNote: "[league commissionerNote]", secretCode: "[league secretCode]", extra: { contact: "[league extra]" } } });
    expect(r.placeholderOf("ask Zorblax Quintavious")).toBe("[league commissionerNote]");
    expect(r.placeholderOf("777")).toBeUndefined();
  });

  it("swaps the league's host for the placeholder host everywhere", () => {
    const r = new Redactor("mfl-test");
    expect(registerLeagueHost(r, "api.myfantasyleague.com")).toBeUndefined();
    expect(registerLeagueHost(r, "evil.example.com")).toBeUndefined();
    expect(registerLeagueHost(r, "WWWTEST.myfantasyleague.com")).toBe(LEAGUE_HOST_PLACEHOLDER);
    expect(r.apply({ baseURL: "https://wwwtest.myfantasyleague.com", homeURL: "https//wwwtest.myfantasyleague.com/2026/home/1" })).toEqual({ baseURL: `https://${LEAGUE_HOST_PLACEHOLDER}`, homeURL: `https//${LEAGUE_HOST_PLACEHOLDER}/2026/home/1` });
    expect(r.scrubText("see https://wwwtest.myfantasyleague.com/2026/export?TYPE=rules")).toBe(`see https://${LEAGUE_HOST_PLACEHOLDER}/2026/export?TYPE=rules`);
  });

  it("trims league.history to the current season", () => {
    const league = { league: { id: "1", history: { league: [{ year: "2026", url: "u26" }, { year: "2021", url: "u21" }, { year: "2024", url: "u24" }] } } };
    const out = trimLeagueHistory(league, 2026);
    expect(out.dropped).toBe(2);
    expect(out.json).toEqual({ league: { id: "1", history: { league: [{ year: "2026", url: "u26" }] } } });
    expect(league.league.history.league).toHaveLength(3); // input untouched
  });

  it("synthesizes the leagueSearch sample from key names only", () => {
    const live = { version: "1.0", encoding: "utf-8", leagues: { league: [{ id: "54321", name: "Zorblax SF Dynasty", homeURL: "https//wwwtest.myfantasyleague.com/2026/home/54321", year: "2026" }, { id: "54322", name: "Quuxwell 2QB", homeURL: "https//wwwalt.myfantasyleague.com/2026/home/54322", year: "2026" }] } };
    expect(homeUrlPrefixes(live)).toEqual({ "https//": 2 });
    const sample = synthesizeSearchSample(live, 2026) as { leagues: { league: Array<Record<string, string>> } };
    const s = JSON.stringify(sample);
    expect(s).not.toMatch(/54321|54322|Zorblax|Quuxwell|wwwtest|wwwalt/);
    expect(sample.leagues.league.map((l) => l.id)).toEqual(["90001", "90002", "90003"]);
    expect(sample.leagues.league[0]).toEqual({ homeURL: `https//${LEAGUE_HOST_PLACEHOLDER}/2026/home/90001`, id: "90001", name: "Search result 1", year: "2026" });
  });

  it("prunes fixtures a run no longer writes, with their index entries", async () => {
    const { createHash } = await import("node:crypto");
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    const dir = await mkdtemp(path.join(tmpdir(), "mfl-prune-"));
    try {
      const keep = `${h("mfl/keep")}.json`;
      const stale = `${h("mfl/stale")}.json`;
      const wrong = `${h("mfl/other-label")}.json`;
      await writeFile(path.join(dir, keep), "{}");
      await writeFile(path.join(dir, stale), "{}");
      await writeFile(path.join(dir, wrong), "{}");
      await writeFile(path.join(dir, "index.json"), JSON.stringify({ [keep]: { label: "mfl/keep" }, [stale]: { label: "mfl/stale" }, [wrong]: { label: "mfl/wrong" }, "gone.json": { label: "mfl/gone" } }));
      const out = await pruneSanitized(dir, [`fixtures/sanitized/mfl/${keep}`, wrong]);
      expect(out.removed.sort()).toEqual(["mfl/gone", "mfl/stale"]);
      expect(out.mismatched).toEqual(["mfl/wrong"]);
      expect((await readdir(dir)).sort()).toEqual([keep, wrong, "index.json"].sort());
      expect(Object.keys(JSON.parse(await readFile(path.join(dir, "index.json"), "utf8")) as object).sort()).toEqual([keep, wrong].sort());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prunes only this probe's fixture files: never subfolders or other files, and a missing folder is fine", async () => {
    const { createHash } = await import("node:crypto");
    const { mkdir } = await import("node:fs/promises");
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    const dir = await mkdtemp(path.join(tmpdir(), "mfl-prune-safe-"));
    try {
      expect(await pruneSanitized(path.join(dir, "missing"), [])).toEqual({ removed: [], mismatched: [] });
      const orphan = `${h("mfl/orphan")}.json`;
      await writeFile(path.join(dir, orphan), "{}");
      await writeFile(path.join(dir, "README.txt"), "notes");
      await mkdir(path.join(dir, "min"));
      await writeFile(path.join(dir, "min", `${h("nested")}.json`), "{}");
      await writeFile(path.join(dir, "index.json"), "{}");
      const out = await pruneSanitized(dir, []);
      expect(out.removed).toEqual([orphan]);
      expect((await readdir(dir)).sort()).toEqual(["README.txt", "index.json", "min"]);
      expect(await readdir(path.join(dir, "min"))).toEqual([`${h("nested")}.json`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("merges watch-list entries without duplicates", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mfl-watch-"));
    const file = path.join(dir, "watchlist.json");
    try {
      expect(await addToWatchlist([{ value: "54321", category: "league-id" }, { value: "Zorblax SF Dynasty", category: "league-name" }, { value: undefined, category: "league-name" }], file)).toBe(2);
      expect(await addToWatchlist([{ value: "54321", category: "league-id" }, { value: " 54322 ", category: "league-id" }], file)).toBe(1);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual([
        { value: "54321", category: "league-id" },
        { value: "Zorblax SF Dynasty", category: "league-name" },
        { value: "54322", category: "league-id" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("docs parsing", () => {
  it("reads access notes per TYPE, argument blocks and phrases", () => {
    const html = "<p>Hello&nbsp;<b>World</b></p><table><tr><td>a</td><td>b</td></tr></table>";
    expect(htmlToText(html)).toContain("Hello World");
    const ref = [
      " | rules | League scoring rules. Test it!",
      " | | L | League Id(required)",
      " | freeAgents | Fantasy free agents. Test it!",
      "Private league access restricted to league owners.",
      " | | L | League Id(required)",
      " | transactions | All non-pending transactions. Test it!",
      "Private league access restricted to league owners.",
      " | | L | League Id(required)",
      " | W | If the week is specified, it returns the transactions for that week.",
      " | TRANS_TYPE | Returns only transactions of the specified type. Types are: WAIVER, FREE_AGENT, TRADE. You may also specify a value of *.",
      " | calendar | Calendar. Test it!",
      "Access restricted to league owners.",
      " | | L | x",
    ].join("\n");
    expect(typeAccess(ref, "rules")).toBe("no access note");
    expect(typeAccess(ref, "freeAgents")).toBe("private leagues: owners only");
    expect(typeAccess(ref, "calendar")).toBe("owners only");
    expect(typeAccess(ref, "standings")).toBe("not documented");
    expect(typeBlock(ref, "transactions", true)).toContain("TRANS_TYPE");
    expect(typeBlock(ref, "transactions", true)).not.toContain("calendar");
    expect(documentedTransTypes(ref)).toEqual(["WAIVER", "FREE_AGENT", "TRADE"]);
    expect(docHas("Wait  one second\nbetween", "wait one second between")).toBe(true);
  });
});
